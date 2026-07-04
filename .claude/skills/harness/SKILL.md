---
name: harness
description: Harness 프레임워크 워크플로우. 작업 시작(브랜치/이슈 파악), 기획자 브랜치 인수, step 설계, phase 파일 생성, execute.py 실행 시 사용한다.
---

이 프로젝트는 Harness 프레임워크를 사용한다. 아래 워크플로우에 따라 작업을 진행하라.

각 단계의 상세 규칙은 단계에 진입할 때만 해당 reference 파일을 읽어라. 미리 전부 읽지 마라.

| 단계 | 상세 문서 (필요할 때 읽기) |
|------|--------------------------|
| C. Step 설계 | `references/step-design.md` |
| D. 파일 생성 (index.json / step{N}.md 포맷) | `references/phase-files.md` |
| E. 실행 / 에러 복구 / 마무리 | `references/execution.md` |

## 업무 방식

할 일이 이슈에만 등록되어 있지 않다. 작업 소스는 두 가지다:

1. **기획자 브랜치** — 기획자가 별도 브랜치에서 바이브코딩한 결과물. 개발자가 인수해 리뷰·수정·정리한다.
2. **이슈** — 루트 `ISSUES.md`와 GitHub 이슈에 등록된 작업.

따라서 모든 작업은 새 브랜치와 브랜치별 변경 내용, 이슈 내용을 읽는 것에서 시작한다.

## A. 작업 파악

1. **브랜치 현황** 확인:

   ```bash
   git fetch --all --prune
   git branch -r                                  # 원격 브랜치 목록
   git log --oneline main..origin/{branch}        # 브랜치별 신규 커밋
   git diff --stat main...origin/{branch}         # 변경 파일 요약
   ```

   main에 없는 커밋을 가진 브랜치가 기획자 작업물 후보다.

2. **이슈** 확인: 루트 `ISSUES.md`를 읽고, `gh issue list --state open`으로 GitHub 이슈도 확인한다.

3. 작업과 관련된 `/docs/` 문서만 읽는다 (PRD=기획, ARCHITECTURE=구조, ADR=기술 결정, UI_GUIDE=화면, PROMPT_GUIDE=AI 프롬프트). 필요시 Explore 에이전트를 병렬로 사용한다.

4. 파악한 브랜치·이슈 현황을 요약해 사용자에게 보고하고, 어떤 작업을 진행할지 확인한다.

## B. 작업 유형별 진행

### B-1. 브랜치 인수 (기획자 바이브코딩 정리)

1. `git diff main...{branch}` 전체와 해당 브랜치의 실제 코드를 꼼꼼히 읽는다. diff 요약만 보고 판단하지 마라.
2. 아래 관점으로 점검하고 발견 사항을 목록화한다:
   - CLAUDE.md CRITICAL 규칙 위반 (예: 클라이언트 사이드 AI 키 사용)
   - ARCHITECTURE.md 설계 이탈 (파이프라인 구조, 엔드포인트 분리 등)
   - 버그·보안 문제 (키/시크릿 노출, 입력 검증 누락 등)
   - 테스트 부재, 중복 코드, 죽은 코드
3. 발견 사항과 수정 범위를 사용자와 논의해 확정한다. 관련 이슈가 있으면 함께 반영한다.
4. 확정되면 `references/step-design.md`를 읽고 C(Step 설계)로 진행한다. 작업 브랜치는 기획자 브랜치를 그대로 쓴다 (phase index.json의 `branch` 필드).

### B-2. 이슈 기반 신규 작업

이슈 내용에서 요구사항을 추출하고, 구체화하거나 기술적으로 결정해야 할 사항이 있으면 사용자에게 제시하고 논의한다. 계획 작성 지시를 받으면 `references/step-design.md`를 읽고 C로 진행한다.
