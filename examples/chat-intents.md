# Teams DM Intent Examples (Canvas LMS MVP)

Scope: DM-only interactions for academic assistant behavior.

## Intent: "What is due today?"

- User message: `What is due today?`
- Host tool call:

```json
{
  "tool": "canvas_lms",
  "args": {
    "action": "sync_academic_digest",
    "range": "today"
  }
}
```

- Host behavior: format digest summary and send back to Teams DM.

## Intent: "What is due this week?"

- User message: `What is due this week?`
- Host tool call:

```json
{
  "tool": "canvas_lms",
  "args": {
    "action": "sync_academic_digest",
    "range": "week"
  }
}
```

- Host behavior: include upcoming assignments and deadlines in DM response.

## Intent: "Any new announcements?"

- User message: `Any new announcements?`
- Host tool call (course-scoped example):

```json
{
  "tool": "canvas_lms",
  "args": {
    "action": "list_announcements",
    "courseId": "<COURSE_ID_PLACEHOLDER>",
    "limit": 10
  }
}
```

- Host behavior: summarize recent announcements in DM-only format.

## DM-only policy reminder

- Do not post MVP academic digests into Teams channels/groups.
- Keep responses in direct message until identity binding and authorization controls are mature.
