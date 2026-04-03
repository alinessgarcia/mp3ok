# QA Verification Report - MP3OK Web APK

Date: 2026-04-02

Environment:
- Windows / PowerShell
- Node v24.14.0
- npm 11.9.0
- yt-dlp 2026.03.03
- ffmpeg 8.0.1

Local startup used for this verification:
- Backend: `Set-Location C:\Users\carli\mp3ok; $env:AUTH_REQUIRED='false'; npm start --prefix backend`
- Frontend: `Set-Location C:\Users\carli\mp3ok; npm run dev --prefix frontend`

Smoke script:
- `node C:\Users\carli\mp3ok\scripts\qa-smoke.mjs`

Summary:
- OK: 18
- FALHA: 1
- Main blocker: frontend root route returns `500`

## Results

| Scenario | Command | Result | Status | Action suggested |
|---|---|---:|---|---|
| Frontend root responds | `GET http://127.0.0.1:3000/` | `HTTP 500; text/html` | FALHA | Fix the frontend crash before UI verification. The log shows `Cannot access 'cancelInfoSearch' before initialization` in `frontend/src/app/page.tsx:416`. |
| Backend 404 | `GET http://127.0.0.1:4000/api/does-not-exist` | `HTTP 404; Cannot GET /api/does-not-exist` | OK | None. |
| `/api/health` | `GET http://127.0.0.1:4000/api/health` | `HTTP 200; {"ok":true,"service":"mp3ok-backend",...}` | OK | None. |
| `/api/info` basic media | `GET http://127.0.0.1:4000/api/info?url=https://download.samplelib.com/mp4/sample-5s.mp4` | `HTTP 200; title=sample-5s; isPlaylist=false` | OK | None. |
| Playlist expansion | `GET http://127.0.0.1:4000/api/info?url=https://vimeo.com/channels/1038168` | `HTTP 200; isPlaylist=true; entryCount=14` | OK | None. |
| Playlist item download | `GET http://127.0.0.1:4000/api/download?url=https://vimeo.com/channels/1038168/183723604&format=video&quality=best&id=550e8400-e29b-41d4-a716-446655440010&title=Playlist%20item%20manual` | `HTTP 200; bytes=62171797; content-type=video/mp4` | OK | None. |
| `/api/download` video | `GET http://127.0.0.1:4000/api/download?url=https://download.samplelib.com/mp4/sample-5s.mp4&format=video&quality=best&id=550e8400-e29b-41d4-a716-446655440011&title=QA%20Video` | `HTTP 200; bytes=2848208; content-type=video/mp4` | OK | None. |
| `/api/download` audio MP3 | `GET http://127.0.0.1:4000/api/download?url=https://download.samplelib.com/mp3/sample-3s.mp3&format=audio&quality=best&id=550e8400-e29b-41d4-a716-446655440012&title=QA%20Audio` | `HTTP 200; bytes=78411; content-type=audio/mpeg` | OK | None. |
| Media job lifecycle | `POST /api/media/jobs` with `tmp-ui-test.png` + `optimize-png` + `balanced`; poll `GET /api/media/jobs`; `GET /api/media/jobs/:id/download`; `DELETE /api/media/jobs/:id` | `created -> completed; download bytes=116; removed=1` | OK | None. |
| Thumbnail job lifecycle | `POST /api/thumbnails/jobs` with `tmp-ui-test.png` + `thumbnail` + `16x9`; poll `GET /api/thumbnails/jobs`; `GET /api/thumbnails/jobs/:id/download`; `POST /api/thumbnails/jobs/delete` | `created -> completed; download bytes=3023; removed=1` | OK | None. |
| `/api/news` | `GET http://127.0.0.1:4000/api/news?limit=3` | `HTTP 200; items returned` | OK | None. |
| `/api/news/health` | `GET http://127.0.0.1:4000/api/news/health` | `HTTP 200; status.ok` | OK | None. |
| Timeout probe | `GET http://127.0.0.1:4000/api/info?url=https://download.samplelib.com/mp4/sample-5s.mp4` with `AbortSignal.timeout(250)` | `Timed out as expected` | OK | None. |

## Manual Verification Added

1. Playlist: the playlist URL `https://vimeo.com/channels/1038168` returned `isPlaylist=true` and `entryCount=14`. A single item from that playlist downloaded successfully with non-zero bytes.
2. Audio MP3: direct MP3 download from `https://download.samplelib.com/mp3/sample-3s.mp3` returned `bytes=78411`, so the response body was not empty.

## Remaining Risks

- Frontend root is still broken with a runtime `500`, so UI-level testing is blocked until `frontend/src/app/page.tsx` is fixed.
- Backend download requires a UUID-like `id`; non-UUID values return `400 Task ID invalido`.
- Playlist item availability is not uniform: the first Vimeo item in the playlist returned `0` bytes, while later items returned data. The playlist flow should continue selecting valid entries rather than assuming every entry is downloadable.
- Local backend verification was run with `AUTH_REQUIRED=false` to exercise protected API routes without a JWT. Auth-on behavior still needs a real session token.

## Reproduction Notes

- Full smoke runner: `node C:\Users\carli\mp3ok\scripts\qa-smoke.mjs`
- If you want to rerun only the manual points:
  - Playlist info: `GET /api/info?url=https://vimeo.com/channels/1038168`
  - Playlist item download: `GET /api/download?url=https://vimeo.com/channels/1038168/183723604&format=video&quality=best&id=550e8400-e29b-41d4-a716-446655440010&title=Playlist%20item%20manual`
  - MP3 download: `GET /api/download?url=https://download.samplelib.com/mp3/sample-3s.mp3&format=audio&quality=best&id=550e8400-e29b-41d4-a716-446655440012&title=QA%20Audio`
