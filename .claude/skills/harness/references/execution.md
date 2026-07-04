# E. 실행

```bash
python3 scripts/execute.py {task-name}         # 순차 실행
python3 scripts/execute.py {task-name} --push  # 실행 후 push
```

execute.py가 자동으로 처리하는 것:

- 브랜치 checkout — index.json의 `branch` 필드가 있으면 해당 브랜치(원격 전용이면 tracking 브랜치 생성), 없으면 `feat-{task-name}` 생성/checkout
- 가드레일 주입 — CLAUDE.md 전문 + docs/ 파일 목록을 매 step 프롬프트에 포함 (docs 내용은 step 세션이 필요할 때 직접 읽는다)
- 컨텍스트 누적 — 완료된 step의 summary를 다음 step 프롬프트에 전달
- 자가 교정 — 실패 시 최대 3회 재시도하며, 이전 에러 메시지를 프롬프트에 피드백
- 훅 가드 — step 세션에도 `.claude/settings.json`의 PreToolUse 훅(시크릿 차단, 커밋 형식 검증)이 적용된다
- 2단계 커밋 — 코드 변경(`feat`)과 메타데이터(`chore`)를 분리 커밋
- 타임스탬프 — started_at, completed_at, failed_at, blocked_at 자동 기록

## 에러 복구

- **error 발생 시**: `phases/{task-name}/index.json`에서 해당 step의 `status`를 `"pending"`으로 바꾸고 `error_message`를 삭제한 뒤 재실행한다.
- **blocked 발생 시**: `blocked_reason`에 적힌 사유를 해결한 뒤, `status`를 `"pending"`으로 바꾸고 `blocked_reason`을 삭제한 뒤 재실행한다.

# F. 마무리

- 작업 완료 후 `/review`로 최종 검증한다. 브랜치 인수 작업이면 main 병합 전 필수.
- 해결한 이슈가 있으면 `ISSUES.md` 처리 현황을 업데이트하고, GitHub 이슈면 닫는다 (`gh issue close`).
