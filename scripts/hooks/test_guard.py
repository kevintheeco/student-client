"""guard.py 훅 테스트 — 시크릿 탐지·커밋 메시지 검증.

주의: 트리거 문자열을 소스에 리터럴로 넣으면 이 파일을 쓰는 것 자체가
guard 훅에 차단된다. 반드시 문자열 조합으로 구성한다.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import guard

DAB = "dangerously" + "Allow" + "Browser"


def run_hook(payload) -> subprocess.CompletedProcess:
    data = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run(
        [sys.executable, str(Path(__file__).parent / "guard.py")],
        input=data, capture_output=True, text=True,
    )


class TestFindSecrets:
    def test_anthropic_key_detected(self):
        assert guard.find_secrets("key = 'sk-ant-" + "a" * 25 + "'")

    def test_google_key_detected(self):
        assert guard.find_secrets("AIza" + "B" * 35)

    def test_allowlisted_firebase_key_passes(self):
        allowed = next(iter(guard.ALLOWLIST))
        assert not guard.find_secrets(f'apiKey:"{allowed}"')

    def test_placeholder_passes(self):
        assert not guard.find_secrets('ACADEMY_KEYS 값 예시: {"mj7x2a":"sk-ant-..."}')

    def test_env_var_reference_passes(self):
        assert not guard.find_secrets("const key = process.env.ANTHROPIC_API_KEY;")

    def test_dangerously_allow_browser_detected(self):
        assert guard.find_secrets("new Anthropic({ " + DAB + ": true })")

    def test_hardcoded_cred_assignment_detected(self):
        assert guard.find_secrets('API_KEY = "' + "abc123" + "def456" + "ghi789jk" + '"')
        assert guard.find_secrets("token: '" + "x9y8z7" + "w6v5u4" + "t3s2r1q0" + "'")

    def test_letters_only_placeholder_passes(self):
        assert not guard.find_secrets('api_key = "your-api-key-goes-here"')

    def test_env_var_assignment_passes(self):
        assert not guard.find_secrets("const apiKey = process.env.ANTHROPIC_API_KEY;")
        assert not guard.find_secrets('key = os.environ["UPSTAGE_API_KEY"]')


class TestForbiddenFile:
    def test_env_files_forbidden(self):
        assert guard.forbidden_file(".env")
        assert guard.forbidden_file("proxy/.env.production")
        assert guard.forbidden_file(".dev.vars")
        assert guard.forbidden_file("certs/server.pem")

    def test_example_and_normal_files_allowed(self):
        assert not guard.forbidden_file(".env.example")
        assert not guard.forbidden_file("src/environment.ts")
        assert not guard.forbidden_file("scripts/execute.py")


class TestWriteHook:
    def test_blocks_secret_in_write(self):
        r = run_hook({"tool_name": "Write", "tool_input": {"content": "sk-ant-" + "x" * 25}})
        assert r.returncode == 2
        assert "차단" in r.stderr

    def test_allows_clean_write(self):
        r = run_hook({"tool_name": "Write", "tool_input": {"content": "hello world"}})
        assert r.returncode == 0

    def test_blocks_secret_in_edit_new_string(self):
        r = run_hook({"tool_name": "Edit", "tool_input": {"new_string": "ghp_" + "a1" * 20}})
        assert r.returncode == 2


class TestBashHook:
    def test_blocks_bad_commit_message(self):
        r = run_hook({"tool_name": "Bash", "tool_input": {"command": 'git commit -m "update stuff"'}})
        assert r.returncode == 2
        assert "conventional" in r.stderr

    def test_allows_conventional_commit(self):
        r = run_hook({"tool_name": "Bash", "tool_input": {"command": 'git commit -m "feat(api): add endpoint"'}})
        assert r.returncode == 0

    def test_ignores_non_commit_command(self):
        r = run_hook({"tool_name": "Bash", "tool_input": {"command": "git status"}})
        assert r.returncode == 0

    def test_bad_payload_passes_silently(self):
        r = run_hook("not json")
        assert r.returncode == 0

    def test_blocks_git_add_env_file(self):
        r = run_hook({"tool_name": "Bash", "tool_input": {"command": "git add .env && git commit -m 'feat: x'"}})
        assert r.returncode == 2
        assert ".env" in r.stderr
