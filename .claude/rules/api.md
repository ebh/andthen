---
paths:
  - "src/worker/**"
  - "src/shared/api.ts"
  - "src/client/api.ts"
  - "test/**"
  - "src/worker/**/*.test.ts"
---

# API route rules

What every route must look like: the usual REST conventions, plus the choices this app made. `docs/api.md` lists the routes that exist. `docs/domain.md` gives the words the paths use.

## Paths

- **Every path starts with `/api/`.** There is no version in the URL. The client sends `X-Api-Level` instead (`docs/api.md`, "Versioning"), and a change that breaks shipped clients bumps `API_LEVEL` in `src/shared/apiLevel.ts`.
- **Path words are terms from `docs/domain.md`**, lowercase kebab-case: `/push-subscriptions`, never `/pushSubscriptions`.
- **A collection is a plural noun and a member is its ID under it**: `/api/stories`, `/api/stories/:storyId`.
- **A path parameter is named after its resource**: `:storyId`, `:participantId`, never `:id`.
- **A singular noun is for a resource that exists once within its parent.**
- **Nest at most two levels**: `/api/stories/:storyId/participants/:participantId`. A resource that would nest deeper gets its own top-level collection.
- **Paths name resources, not actions.** When no resource models a state change, use `POST` to a verb sub-path of the resource: `/api/stories/:storyId/skip`. Try a noun first.
- **A list that can grow without bound takes `limit` and `cursor` query parameters.** Filtering and sorting are query parameters too.

## Methods and status

- **`GET` reads.** It is safe, repeatable and has no body.
- **`POST` to a collection creates a member.** Answer 201 with a `Location` header for the new member and its ID in the body.
- **`PUT` replaces a whole resource at a known path, and `PATCH` changes part of one.**
- **`DELETE` removes the resource its path names.** It has no body. `PUT` and `DELETE` give the same result when repeated.
- **A write that returns nothing answers 204.** Clients refetch the story; the live socket says when.
- **A `POST` that creates no stored record but costs something or can't be repeated returns 200 with its data**, as suggestions do.
- **Each failure gets the status that matches its cause**: 400 for a bad request, 403 for not allowed, 404 for not found, 409 for a clash with the current state.
- **Every write runs behind the guards in `src/worker/app.ts`**, and behind the turn version check when it changes a story's turn. `docs/api.md` ("Guards", "Writes and races") says how.

## Shapes

- **Request and response schemas go in `src/shared/api.ts`**, parsed with Zod on both sides.
- **Field names are camelCase and name a term from `docs/domain.md`.** An ID is `<term>Id`.
- **An error body is `{error: <code>}`.** Codes are snake_case, name a cause from `docs/domain.md`, and are added to `errorCodeSchema` in `src/shared/api.ts`, with their status in `ERROR_STATUS` in `src/worker/http.ts`. One code per cause a client acts on differently.

## Done means

- **The route has a row in the `docs/api.md` table**, with its success status and the guard it relies on.
- **It has an integration test** that covers the success status and sends each error code once, per `.claude/rules/integration-tests.md`. The rule behind an error has its variants unit tested, not repeated here.
- **A new domain word has its entry in `docs/domain.md`**, per `.claude/rules/naming.md`.
- **A route that already breaks a rule here has a chore issue.** Leave it alone until that issue is picked up.
