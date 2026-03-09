import { Type } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  resolveCanvasAuthToken,
  resolveOAuthConfig,
  shouldRefreshToken,
} from "./canvas-lms-auth.ts";
import { fetchPaginatedArray, type FetchLike } from "./canvas-lms-http.ts";
import {
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  buildAcademicDigest,
  computeRetryAfterMs,
  extractNextLink,
  formatDateInTimeZone,
  normalizeBaseUrl,
  parseExpiresAtMs,
  readConfigString,
  readPerPage,
  readPositiveInt,
  readString,
  readStringArray,
  redactSensitive,
  resolveBaseUrl,
  resolveDigestDateRange,
  type CanvasLmsPluginConfig,
} from "./canvas-lms-utils.ts";

const CANVAS_LMS_ACTIONS = [
  "list_courses",
  "list_assignments",
  "list_announcements",
  "list_modules",
  "list_submissions",
  "list_calendar_events",
  "list_grades",
  "list_course_files",
  "sync_academic_digest",
] as const;
const ASSIGNMENT_BUCKETS = ["all", "upcoming", "undated", "past"] as const;
const DIGEST_WINDOWS = ["today", "week"] as const;

type CanvasAction = (typeof CANVAS_LMS_ACTIONS)[number];

type CanvasRequestContext = {
  fetchImpl: FetchLike;
  apiBase: string;
  token: string;
  perPage: number;
  maxPages: number;
  timeoutMs: number;
  maxRetries: number;
};

type DigestItem = {
  courseId: string;
  courseName: string;
  assignmentId: string;
  assignmentName: string;
  dueAt: string;
  htmlUrl?: string;
};

function isCanvasAction(value: string): value is CanvasAction {
  return (CANVAS_LMS_ACTIONS as readonly string[]).includes(value);
}

function requireStringArg(
  args: Record<string, unknown>,
  key: string,
  errorMessage: string,
): string {
  const value = readString(args, key);
  if (!value) {
    throw new Error(errorMessage);
  }
  return value;
}

function fetchCanvasRows(
  context: CanvasRequestContext,
  firstPath: string,
  overrides?: { maxPages?: number },
) {
  return fetchPaginatedArray({
    fetchImpl: context.fetchImpl,
    apiBase: context.apiBase,
    token: context.token,
    firstPath,
    maxPages: overrides?.maxPages ?? context.maxPages,
    timeoutMs: context.timeoutMs,
    maxRetries: context.maxRetries,
  });
}

function simplifyRows(action: CanvasAction, rows: unknown[]) {
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    if (action === "list_courses") {
      return {
        id: item.id,
        name: item.name,
        courseCode: item.course_code,
        workflowState: item.workflow_state,
        startAt: item.start_at,
        endAt: item.end_at,
      };
    }
    if (action === "list_assignments") {
      return {
        id: item.id,
        name: item.name,
        dueAt: item.due_at,
        pointsPossible: item.points_possible,
        htmlUrl: item.html_url,
      };
    }
    if (action === "list_modules") {
      return {
        id: item.id,
        name: item.name,
        unlockAt: item.unlock_at,
        state: item.state,
        itemsCount: Array.isArray(item.items) ? item.items.length : undefined,
      };
    }
    if (action === "list_submissions") {
      return {
        assignmentId: item.assignment_id,
        userId: item.user_id,
        submittedAt: item.submitted_at,
        score: item.score,
        grade: item.grade,
        workflowState: item.workflow_state,
        late: item.late,
        missing: item.missing,
      };
    }
    if (action === "list_calendar_events") {
      return {
        id: item.id,
        title: item.title,
        startAt: item.start_at,
        endAt: item.end_at,
        allDay: item.all_day,
        locationName: item.location_name,
        htmlUrl: item.html_url,
      };
    }
    if (action === "list_grades") {
      const grades =
        item.grades && typeof item.grades === "object"
          ? (item.grades as Record<string, unknown>)
          : undefined;
      return {
        enrollmentId: item.id,
        userId: item.user_id,
        type: item.type,
        currentGrade: grades?.current_grade,
        currentScore: grades?.current_score,
        finalGrade: grades?.final_grade,
        finalScore: grades?.final_score,
        currentPoints: item.current_points,
        unpostedCurrentGrade: grades?.unposted_current_grade,
      };
    }
    if (action === "list_course_files") {
      return {
        id: item.id,
        displayName: item.display_name,
        filename: item.filename,
        size: item.size,
        contentType: item["content-type"],
        updatedAt: item.updated_at,
        url: item.url,
        locked: item.locked,
      };
    }
    return {
      id: item.id,
      title: item.title,
      postedAt: item.posted_at,
      message: item.message,
      htmlUrl: item.html_url,
    };
  });
}

async function executeStandardAction(
  action: Exclude<CanvasAction, "sync_academic_digest">,
  args: Record<string, unknown>,
  context: CanvasRequestContext,
): Promise<unknown[]> {
  if (action === "list_courses") {
    const includeCompleted = args.includeCompleted === true;
    const enrollmentState = includeCompleted ? "all" : "active";
    return fetchCanvasRows(
      context,
      `/courses?per_page=${context.perPage}&enrollment_state=${enrollmentState}`,
    );
  }

  if (action === "list_assignments") {
    const courseId = requireStringArg(args, "courseId", "courseId is required for list_assignments");
    const bucket = readString(args, "bucket") ?? "upcoming";
    return fetchCanvasRows(
      context,
      `/courses/${encodeURIComponent(courseId)}/assignments?per_page=${context.perPage}&bucket=${encodeURIComponent(
        bucket,
      )}`,
    );
  }

  if (action === "list_announcements") {
    const courseId = requireStringArg(
      args,
      "courseId",
      "courseId is required for list_announcements",
    );
    return fetchCanvasRows(
      context,
      `/courses/${encodeURIComponent(courseId)}/discussion_topics?only_announcements=true&per_page=${context.perPage}`,
    );
  }

  if (action === "list_modules") {
    const courseId = requireStringArg(args, "courseId", "courseId is required for list_modules");
    return fetchCanvasRows(
      context,
      `/courses/${encodeURIComponent(courseId)}/modules?include[]=items&per_page=${context.perPage}`,
    );
  }

  if (action === "list_submissions") {
    const courseId = requireStringArg(
      args,
      "courseId",
      "courseId is required for list_submissions",
    );
    const studentId = readString(args, "studentId") ?? "self";
    const assignmentId = readString(args, "assignmentId");
    const assignmentFilter = assignmentId
      ? `&assignment_ids[]=${encodeURIComponent(assignmentId)}`
      : "";
    return fetchCanvasRows(
      context,
      `/courses/${encodeURIComponent(courseId)}/students/submissions?per_page=${context.perPage}&student_ids[]=${encodeURIComponent(
        studentId,
      )}${assignmentFilter}`,
    );
  }

  if (action === "list_calendar_events") {
    const courseId = requireStringArg(
      args,
      "courseId",
      "courseId is required for list_calendar_events",
    );
    const startDate = readString(args, "startDate");
    const endDate = readString(args, "endDate");
    const dateFilter = `${startDate ? `&start_date=${encodeURIComponent(startDate)}` : ""}${
      endDate ? `&end_date=${encodeURIComponent(endDate)}` : ""
    }`;
    return fetchCanvasRows(
      context,
      `/calendar_events?context_codes[]=${encodeURIComponent(`course_${courseId}`)}&per_page=${context.perPage}${dateFilter}`,
    );
  }

  if (action === "list_grades") {
    const courseId = requireStringArg(args, "courseId", "courseId is required for list_grades");
    const studentId = readString(args, "studentId") ?? "self";
    return fetchCanvasRows(
      context,
      `/courses/${encodeURIComponent(courseId)}/enrollments?type[]=StudentEnrollment&user_id=${encodeURIComponent(
        studentId,
      )}&include[]=grades&include[]=current_points&include[]=total_scores&per_page=${context.perPage}`,
    );
  }

  const courseId = requireStringArg(args, "courseId", "courseId is required for list_course_files");
  return fetchCanvasRows(
    context,
    `/courses/${encodeURIComponent(courseId)}/files?per_page=${context.perPage}`,
  );
}

async function executeAcademicDigest(
  action: CanvasAction,
  args: Record<string, unknown>,
  context: CanvasRequestContext,
  pluginConfig: CanvasLmsPluginConfig,
) {
  const digestWindow =
    (readString(args, "digestWindow") as "today" | "week" | undefined) ?? "week";
  const publish = args.publish === true;
  const legacyPublishSessionKey = readString(args, "publishSessionKey");
  const requestedPublishSessionKeys = readStringArray(args.publishSessionKeys);
  const configuredPublishSessionKeys = readStringArray(pluginConfig.digestPublishSessionKeys);
  const publishSessionKeys = Array.from(
    new Set([
      ...(legacyPublishSessionKey ? [legacyPublishSessionKey] : []),
      ...requestedPublishSessionKeys,
      ...configuredPublishSessionKeys,
    ]),
  );
  if (publish) {
    throw new Error(
      "sync_academic_digest publish=true is not supported in this third-party plugin. Use host automation/workflow to deliver the returned digest to Discord/Teams/WhatsApp/Telegram.",
    );
  }

  const timeZone = readString(args, "timeZone") ?? "UTC";
  try {
    void formatDateInTimeZone(new Date(), timeZone);
  } catch {
    throw new Error(`Invalid timeZone: ${timeZone}`);
  }

  const now = new Date();
  const range = resolveDigestDateRange({ window: digestWindow, now });
  const explicitCourseId = readString(args, "courseId");

  const courses = explicitCourseId
    ? [{ id: explicitCourseId, name: `Course ${explicitCourseId}` }]
    : (
        await fetchCanvasRows(
          context,
          `/courses?per_page=${Math.min(context.perPage, 30)}&enrollment_state=active`,
          { maxPages: 1 },
        )
      )
        .map((row) => row as Record<string, unknown>)
        .map((course) => ({
          id: String(course.id ?? ""),
          name: String(course.name ?? course.course_code ?? "Untitled course"),
        }))
        .filter((course) => course.id);

  const dueItems: DigestItem[] = [];
  for (const course of courses) {
    const assignments = await fetchCanvasRows(
      context,
      `/courses/${encodeURIComponent(course.id)}/assignments?per_page=${context.perPage}&bucket=upcoming`,
      { maxPages: 1 },
    );
    for (const row of assignments) {
      const item = row as Record<string, unknown>;
      const dueAt = readConfigString(item.due_at);
      if (!dueAt) {
        continue;
      }
      const dueDate = new Date(dueAt);
      if (Number.isNaN(dueDate.getTime())) {
        continue;
      }
      if (dueDate < range.start || dueDate >= range.end) {
        continue;
      }
      dueItems.push({
        courseId: course.id,
        courseName: course.name,
        assignmentId: String(item.id ?? ""),
        assignmentName: String(item.name ?? "Untitled assignment"),
        dueAt,
        htmlUrl: readConfigString(item.html_url),
      });
    }
  }

  dueItems.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const summary = buildAcademicDigest({
    items: dueItems,
    window: digestWindow,
    now,
    timeZone,
  });

  return {
    content: [{ type: "text", text: summary }],
    details: {
      action,
      window: digestWindow,
      timeZone,
      totalDue: dueItems.length,
      coursesScanned: courses.length,
      publishRequested: publish,
      suggestedPublishSessionKeys: publishSessionKeys,
    },
  };
}

export function createCanvasLmsTool(api: OpenClawPluginApi) {
  const pluginConfig = (api.pluginConfig ?? {}) as CanvasLmsPluginConfig;
  return {
    name: "canvas-lms",
    label: "Canvas LMS",
    description:
      "Read data from Canvas LMS (courses, assignments, announcements, modules, submissions, calendar, grades, files) using a Canvas API token.",
    parameters: Type.Object({
      action: stringEnum(CANVAS_LMS_ACTIONS, {
        description: `Action to perform: ${CANVAS_LMS_ACTIONS.join(", ")}`,
      }),
      baseUrl: Type.Optional(
        Type.String({
          description: "Canvas base URL, for example: https://canvas.university.edu",
        }),
      ),
      token: Type.Optional(
        Type.String({
          description:
            "Canvas API token (inline). Disabled by default unless plugin config allowInlineToken=true.",
        }),
      ),
      courseId: Type.Optional(
        Type.String({
          description:
            "Canvas course ID (required for assignments, announcements, modules, and submissions).",
        }),
      ),
      assignmentId: Type.Optional(
        Type.String({
          description: "Canvas assignment ID (optional filter for list_submissions).",
        }),
      ),
      studentId: Type.Optional(
        Type.String({
          description: "Canvas student identifier for list_submissions (default: self).",
        }),
      ),
      digestWindow: optionalStringEnum(DIGEST_WINDOWS, {
        description: "Digest range for sync_academic_digest: today or week (default week).",
      }),
      publish: Type.Optional(
        Type.Boolean({
          description:
            "Reserved for host-level automation. Third-party plugin returns digest only (no direct publish).",
        }),
      ),
      publishSessionKey: Type.Optional(
        Type.String({
          description: "Reserved for host-level automation (single target key).",
        }),
      ),
      publishSessionKeys: Type.Optional(
        Type.Array(
          Type.String({
            description: "Reserved for host-level automation (multiple target keys).",
          }),
        ),
      ),
      timeZone: Type.Optional(
        Type.String({
          description:
            "IANA timezone for digest grouping/formatting (e.g. America/Santiago). Defaults UTC.",
        }),
      ),
      startDate: Type.Optional(
        Type.String({
          description: "ISO date or datetime for calendar filters (used by list_calendar_events).",
        }),
      ),
      endDate: Type.Optional(
        Type.String({
          description: "ISO date or datetime for calendar filters (used by list_calendar_events).",
        }),
      ),
      bucket: optionalStringEnum(ASSIGNMENT_BUCKETS, {
        description: "Assignment bucket (used by list_assignments).",
      }),
      perPage: Type.Optional(Type.Number({ description: "Page size (1-100). Defaults to 20." })),
      includeCompleted: Type.Optional(
        Type.Boolean({
          description: "Include completed/inactive courses (list_courses only).",
        }),
      ),
    }),
    async execute(_id: string, args: Record<string, unknown>) {
      const action = readString(args, "action");
      if (!action) {
        throw new Error("action is required");
      }
      if (!isCanvasAction(action)) {
        throw new Error(`Unsupported action: ${action}`);
      }

      const allowInsecureHttp =
        pluginConfig.allowInsecureHttp === true ||
        process.env.CANVAS_LMS_ALLOW_INSECURE_HTTP === "1";
      const baseUrl = resolveBaseUrl({ args, pluginConfig, allowInsecureHttp });
      const timeoutMs = readPositiveInt(pluginConfig.requestTimeoutMs, {
        fallback: DEFAULT_TIMEOUT_MS,
        min: 1_000,
        max: 120_000,
      });
      const maxRetries = readPositiveInt(pluginConfig.maxRetries, {
        fallback: DEFAULT_MAX_RETRIES,
        min: 0,
        max: 5,
        allowZero: true,
      });
      const maxPages = readPositiveInt(pluginConfig.maxPages, {
        fallback: DEFAULT_MAX_PAGES,
        min: 1,
        max: 50,
      });
      const token = await resolveCanvasAuthToken({
        args,
        pluginConfig,
        baseUrl,
        allowInsecureHttp,
        timeoutMs,
        maxRetries,
        fetchImpl: fetch,
      });
      const context: CanvasRequestContext = {
        fetchImpl: fetch,
        apiBase: `${baseUrl}/api/v1`,
        token,
        perPage: readPerPage(args, pluginConfig.defaultPerPage),
        maxPages,
        timeoutMs,
        maxRetries,
      };

      if (action === "sync_academic_digest") {
        return executeAcademicDigest(action, args, context, pluginConfig);
      }

      const rows = await executeStandardAction(action, args, context);
      const simplified = simplifyRows(action, rows);
      return {
        content: [{ type: "text", text: JSON.stringify(simplified, null, 2) }],
        details: {
          action,
          total: simplified.length,
          baseUrl,
        },
      };
    },
  };
}

export const __test = {
  normalizeBaseUrl,
  extractNextLink,
  computeRetryAfterMs,
  parseExpiresAtMs,
  resolveOAuthConfig,
  shouldRefreshToken,
  fetchPaginatedArray,
  redactSensitive,
  resolveBaseUrl,
};
