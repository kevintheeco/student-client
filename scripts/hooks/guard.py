#!/usr/bin/env python3
"""
Claude Code PreToolUse 가드 훅.

- Write/Edit: 파일에 쓰려는 내용에서 API 키/시크릿 패턴을 탐지하면 차단한다.
- Bash(git commit): 스테이징된 diff에서 시크릿을 탐지하면 차단하고,
  -m 메시지가 있으면 conventional commits 형식을 검증한다.

exit 0 = 허용, exit 2 = 차단 (stderr 메시지가 Claude에게 전달됨).
"""

import json
import re
import subprocess
import sys

# 실제 크리덴셜 형태만 매칭한다. 오탐(문서의 플레이스홀더 등)을 줄이기 위해
# 각 패턴은 프리픽스 + 충분한 길이의 본문을 요구한다.
SECRET_PATTERNS = [
    ("Anthropic API key", r"sk-ant-[A-Za-z0-9_-]{20,}"),
    ("OpenAI API key", r"sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}"),
    ("Google API key", r"AIza[A-Za-z0-9_-]{35}"),
    ("GitHub token", r"(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}"),
    ("Pinecone API key", r"pcsk_[A-Za-z0-9_-]{20,}"),
    ("Upstage API key", r"up_[A-Za-z0-9]{20,}"),
    ("Private key block", r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    ("Supabase service_role JWT", r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\."),
    ("클라이언트 사이드 AI 키 사용 (CRITICAL 위반)", r"dangerouslyAllowBrowser"),
]

# 공개여도 되는 값 (Firebase 웹 config apiKey는 설계상 공개 식별자)
ALLOWLIST = {
    "AIzaSyD0ObaK3aKotOjKjtg1MGz_SB4qHX0DhdA",
}

# key/token/secret 계열 변수에 리터럴 문자열을 대입하는 패턴.
# 토큰은 반드시 환경변수 이름으로만 접근한다 (process.env.X / os.environ["X"] / env.X).
GENERIC_CRED_RE = re.compile(
    r"""(?ix)\b(?:api[_-]?key|apikey|secret|token|passwd|password|credential|access[_-]?key)\b
        \s*[:=]\s*["']([A-Za-z0-9_\-+/=]{16,})["']"""
)

# 커밋에 포함되면 안 되는 파일 (토큰 값은 gitignore된 파일/시크릿 매니저에만 둔다)
def forbidden_file(path: str) -> bool:
    name = path.replace("\\", "/").rsplit("/", 1)[-1]
    if name == ".dev.vars":
        return True
    if name.startswith(".env") and name not in (".env.example", ".env.sample", ".env.template"):
        return True
    return bool(re.search(r"\.(pem|p12|pfx)$", name, re.I))

CONVENTIONAL_RE = re.compile(
    r"^(feat|fix|docs|refactor|chore|test|style|perf|ci|build)(\([^)]+\))?!?: .+"
)


def find_secrets(text: str):
    hits = []
    for label, pat in SECRET_PATTERNS:
        for m in re.finditer(pat, text):
            if m.group(0) in ALLOWLIST:
                continue
            hits.append((label, m.group(0)[:12] + "…"))
    for m in GENERIC_CRED_RE.finditer(text):
        value = m.group(1)
        # 실제 토큰은 대개 영숫자 혼합 — 숫자 2개 미만이면 플레이스홀더로 간주
        if value in ALLOWLIST or sum(c.isdigit() for c in value) < 2:
            continue
        hits.append(("하드코딩된 크리덴셜 (환경변수로 접근하라)", m.group(0)[:20] + "…"))
    return hits


def block(msg: str):
    print(msg, file=sys.stderr)
    sys.exit(2)


def check_write(tool_input: dict):
    text = tool_input.get("content") or tool_input.get("new_string") or ""
    hits = find_secrets(text)
    if hits:
        detail = "\n".join(f"  - {label}: {frag}" for label, frag in hits)
        block(
            "시크릿으로 보이는 값이 파일에 기록되려 함 — 차단됨.\n"
            f"{detail}\n"
            "키는 환경변수/시크릿 매니저(wrangler secret 등)로 관리하라. "
            "예시가 필요하면 'sk-ant-...' 같은 잘린 플레이스홀더를 써라."
        )


def check_bash(tool_input: dict):
    cmd = tool_input.get("command") or ""
    if not re.search(r"\bgit\b.*\b(commit|add)\b", cmd):
        return

    # 0) env/키 파일이 커밋 대상에 끼어드는지 — 커맨드 인자와 스테이징 목록 양쪽 확인
    cmd_files = [t for t in re.split(r"[\s'\"&;|]+", cmd) if t and forbidden_file(t)]
    staged = subprocess.run(["git", "diff", "--cached", "--name-only"], capture_output=True, text=True)
    staged_bad = [f for f in staged.stdout.splitlines() if f and forbidden_file(f)]
    bad = sorted(set(cmd_files + staged_bad))
    if bad:
        block(
            f"환경변수/키 파일을 git에 올리려 함 — 차단됨: {', '.join(bad)}\n"
            "이 파일들은 .gitignore에 두고 커밋하지 않는다. 코드에서는 환경변수 이름으로만 접근하라."
        )

    if not re.search(r"\bgit\b.*\bcommit\b", cmd):
        return

    # 1) 스테이징된 변경에서 시크릿 스캔 (-a/-am 이면 워킹트리도 포함)
    diffs = [subprocess.run(["git", "diff", "--cached", "-U0"], capture_output=True, text=True)]
    if re.search(r"\s-a[m]?\b|\s--all\b", cmd):
        diffs.append(subprocess.run(["git", "diff", "-U0"], capture_output=True, text=True))
    added = "\n".join(
        line for d in diffs for line in d.stdout.splitlines()
        if line.startswith("+") and not line.startswith("+++")
    )
    hits = find_secrets(added)
    if hits:
        detail = "\n".join(f"  - {label}: {frag}" for label, frag in hits)
        block(
            "커밋하려는 변경에 시크릿으로 보이는 값이 있음 — 커밋 차단됨.\n"
            f"{detail}\n"
            "해당 값을 제거하고 환경변수/시크릿으로 옮긴 뒤 다시 커밋하라."
        )

    # 2) conventional commits 형식 검증 (-m 메시지를 추출할 수 있을 때만)
    m = re.search(r"-m\s+(['\"])(.+?)\1", cmd, re.DOTALL)
    if m:
        first_line = m.group(2).lstrip().splitlines()[0] if m.group(2).strip() else ""
        # heredoc/명령치환($(...))이 섞이면 검증을 건너뛴다 (오탐 방지)
        if first_line and "$(" not in first_line and not CONVENTIONAL_RE.match(first_line):
            block(
                f"커밋 메시지가 conventional commits 형식이 아님: \"{first_line}\"\n"
                "형식: feat|fix|docs|refactor|chore|test|style|perf(scope): 설명"
            )


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # 페이로드를 못 읽으면 조용히 통과 (훅 오류로 작업을 막지 않음)

    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}

    if tool in ("Write", "Edit", "MultiEdit"):
        check_write(tool_input)
    elif tool == "Bash":
        check_bash(tool_input)

    sys.exit(0)


if __name__ == "__main__":
    main()
