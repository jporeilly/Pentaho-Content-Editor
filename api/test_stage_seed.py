"""desktop/scripts/stage-seed.mjs - what a seeded installer carries.

Run for real under Node against a small Content Manager built in a temp
directory, with `--no-check` (the check runs the real verifier, which
needs the real lowlight; the last test does that against a genuine
checkout when this machine has one).

What matters here is what must NOT ship: the distribution repo is public
and an installer is a second way out for a file git was told to ignore.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "desktop" / "scripts" / "stage-seed.mjs"
NODE = shutil.which("node")
GIT = shutil.which("git")

pytestmark = pytest.mark.skipif(NODE is None, reason="the staging script runs under Node")


def write(path: Path, text="x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def make_pcm(root: Path, *, git: bool) -> Path:
    """A minimal Content Manager: two courses, the scripts, one package."""
    write(root / "package.json", json.dumps({"name": "pcm", "version": "9.9.9", "type": "module"}))
    write(root / ".nvmrc", "24.16.0")
    scripts = root / "scripts"
    write(scripts / "new-course.mjs", 'import { a } from "./lib/helper.mjs";\nimport { T } from "../src/tracks.ts";\n')
    write(scripts / "new-lab.mjs", 'import "node:fs";\nimport { a } from "./lib/helper.mjs";\n')
    write(scripts / "stamp-manifests.mjs", "// nothing\n")
    write(scripts / "verify-course.mjs",
          'import { createLowlight } from "lowlight";\nimport { x } from "highlight.js/lib/languages/dos";\n'
          'export * from "./lib/more.mjs";\n')
    write(scripts / "lib" / "helper.mjs", "export const a = 1;\n")
    write(scripts / "lib" / "more.mjs", "export const b = 2;\n")
    write(scripts / "lib" / "unrelated.mjs", "export const z = 0;\n")  # imported by nothing
    write(scripts / "templates" / "guide.md", "# template\n")
    write(scripts / "build-art.ps1", "not shipped\n")
    write(root / "src" / "tracks.ts", "export const T = 1;\n")
    write(root / "src" / "huge.ts", "not imported\n")
    # lowlight depends on dequal; highlight.js has no deps; "unused" is not imported.
    write(root / "node_modules" / "lowlight" / "package.json", json.dumps({"name": "lowlight", "version": "3.3.0", "dependencies": {"dequal": "^2"}}))
    write(root / "node_modules" / "lowlight" / "index.js")
    write(root / "node_modules" / "dequal" / "package.json", json.dumps({"name": "dequal", "version": "2.0.3"}))
    write(root / "node_modules" / "highlight.js" / "package.json", json.dumps({"name": "highlight.js", "version": "11.11.1"}))
    write(root / "node_modules" / "highlight.js" / "lib" / "languages" / "dos.js")
    write(root / "node_modules" / "unused" / "package.json", json.dumps({"name": "unused", "version": "1.0.0"}))
    for cid in ("alpha", "beta", "_template"):
        write(root / "courses" / cid / "course.json", json.dumps({"id": cid, "title": cid}))
        write(root / "courses" / cid / "SUMMARY.md", "# toc\n")
        write(root / "courses" / cid / "01-lab" / "guide.md", "# lab\n")
    if git:
        write(root / ".gitignore", ".env*\nnode_modules/\n")
        env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        subprocess.run([GIT, "init", "-q", str(root)], check=True)
        subprocess.run([GIT, "-C", str(root), "add", "-A"], check=True)
        subprocess.run([GIT, "-C", str(root), "commit", "-q", "-m", "init"], check=True, env=env)
    # Secrets that exist on disk but must never reach an installer.
    write(root / "courses" / "alpha" / ".env", "TOKEN=secret\n")
    write(root / "courses" / "alpha" / "01-lab" / ".env.local", "TOKEN=secret\n")
    write(root / "courses" / "alpha" / "deploy.pem", "secret\n")
    write(root / "courses" / "alpha" / ".env.template", "TOKEN=\n")
    # Not secret-shaped, so only "git does not track it" keeps it out.
    write(root / "courses" / "alpha" / "scratch.txt", "unfinished\n")
    return root


def stage(pcm: Path, out: Path, *extra, check=False):
    args = [NODE, str(SCRIPT), "--pcm", str(pcm), "--out", str(out), *extra]
    if not check:
        args.append("--no-check")
    return subprocess.run(args, capture_output=True, text=True)


def files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


@pytest.fixture
def pcm_git(tmp_path):
    if GIT is None:
        pytest.skip("needs git")
    return make_pcm(tmp_path / "pcm", git=True)


def test_scripts_are_found_by_walking_imports_not_by_a_list(pcm_git, tmp_path):
    out = tmp_path / "seed"
    res = stage(pcm_git, out)
    assert res.returncode == 0, res.stderr
    got = files(out / "pcm")
    # entries, what they import (including a re-export and a .ts), data dir
    for want in ("scripts/new-course.mjs", "scripts/new-lab.mjs", "scripts/stamp-manifests.mjs",
                 "scripts/verify-course.mjs", "scripts/lib/helper.mjs", "scripts/lib/more.mjs",
                 "src/tracks.ts", "scripts/templates/guide.md", "package.json", ".nvmrc"):
        assert want in got, want
    # what nothing imports stays behind
    for nope in ("scripts/lib/unrelated.mjs", "scripts/build-art.ps1", "src/huge.ts"):
        assert nope not in got, nope


def test_node_modules_is_the_closure_of_what_is_imported(pcm_git, tmp_path):
    out = tmp_path / "seed"
    assert stage(pcm_git, out).returncode == 0
    got = files(out / "pcm")
    assert "node_modules/lowlight/index.js" in got
    assert "node_modules/dequal/package.json" in got          # a dependency of lowlight
    assert "node_modules/highlight.js/lib/languages/dos.js" in got  # a subpath import
    assert not any(f.startswith("node_modules/unused/") for f in got)
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["packages"] == ["dequal@2.0.3", "highlight.js@11.11.1", "lowlight@3.3.0"]


def test_only_files_git_tracks_ship_in_a_course(pcm_git, tmp_path):
    out = tmp_path / "seed"
    assert stage(pcm_git, out).returncode == 0
    got = files(out / "pcm")
    assert "courses/alpha/01-lab/guide.md" in got
    assert "courses/alpha/.env" not in got
    assert "courses/alpha/01-lab/.env.local" not in got
    assert "courses/alpha/deploy.pem" not in got
    # Untracked and not secret-shaped: only git's own answer excludes it.
    assert "courses/alpha/scratch.txt" not in got


def test_underscore_courses_are_authoring_internal(pcm_git, tmp_path):
    out = tmp_path / "seed"
    assert stage(pcm_git, out).returncode == 0
    manifest = json.loads((out / "manifest.json").read_text())
    assert [c["id"] for c in manifest["courses"]] == ["alpha", "beta"]
    assert not any(f.startswith("courses/_template/") for f in files(out / "pcm"))


def test_a_subset_stages_only_those_courses(pcm_git, tmp_path):
    out = tmp_path / "seed"
    assert stage(pcm_git, out, "--courses", "beta").returncode == 0
    got = files(out / "pcm")
    assert "courses/beta/course.json" in got
    assert not any(f.startswith("courses/alpha/") for f in got)


def test_an_unknown_course_is_an_error_naming_the_ones_there_are(pcm_git, tmp_path):
    res = stage(pcm_git, tmp_path / "seed", "--courses", "nope")
    assert res.returncode != 0
    assert "no course" in res.stderr and "alpha" in res.stderr


def test_outside_git_a_skip_list_keeps_the_obvious_secrets_out(tmp_path):
    pcm = make_pcm(tmp_path / "pcm", git=False)
    out = tmp_path / "seed"
    res = stage(pcm, out)
    assert res.returncode == 0, res.stderr
    assert "not a git checkout" in res.stdout
    got = files(out / "pcm")
    assert "courses/alpha/01-lab/guide.md" in got
    assert "courses/alpha/.env.template" in got            # a template is meant to ship
    assert "courses/alpha/scratch.txt" in got              # no git, so no way to know
    assert "courses/alpha/.env" not in got
    assert "courses/alpha/01-lab/.env.local" not in got
    assert "courses/alpha/deploy.pem" not in got


def test_it_will_not_run_without_npm_install(tmp_path):
    pcm = make_pcm(tmp_path / "pcm", git=False)
    shutil.rmtree(pcm / "node_modules")
    res = stage(pcm, tmp_path / "seed")
    assert res.returncode != 0
    assert "npm install" in res.stderr


def test_it_will_not_delete_a_directory_that_is_not_a_seed(pcm_git, tmp_path):
    out = tmp_path / "precious"
    write(out / "thesis.docx", "irreplaceable")
    res = stage(pcm_git, out)
    assert res.returncode != 0
    assert (out / "thesis.docx").read_text() == "irreplaceable"


def test_it_will_not_stage_into_or_around_the_checkout(pcm_git, tmp_path):
    assert stage(pcm_git, pcm_git / "seed").returncode != 0
    assert stage(pcm_git, tmp_path).returncode != 0  # contains the checkout
    assert (pcm_git / "courses" / "alpha" / "course.json").is_file()


def test_a_restage_replaces_the_old_seed_and_the_id_tracks_tooling_only(pcm_git, tmp_path):
    out = tmp_path / "seed"
    assert stage(pcm_git, out).returncode == 0
    first = json.loads((out / "manifest.json").read_text())["id"]

    # Editing a course changes no tooling, so the id holds still: an
    # installed editor must not replace scripts/ because a lab changed.
    write(pcm_git / "courses" / "alpha" / "01-lab" / "guide.md", "# edited\n")
    assert stage(pcm_git, out).returncode == 0
    assert json.loads((out / "manifest.json").read_text())["id"] == first
    assert (out / "pcm" / "courses" / "alpha" / "01-lab" / "guide.md").read_text() == "# edited\n"

    # Changing a script does.
    write(pcm_git / "scripts" / "lib" / "helper.mjs", "export const a = 2;\n")
    assert stage(pcm_git, out).returncode == 0
    assert json.loads((out / "manifest.json").read_text())["id"] != first


def test_the_staged_seed_is_what_the_editor_lays_out(pcm_git, tmp_path, monkeypatch):
    """stage-seed's output and api/seed.py agree on the layout."""
    import seed
    import paths

    out = tmp_path / "seed"
    assert stage(pcm_git, out).returncode == 0
    monkeypatch.setenv("EDITOR_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("EDITOR_SEED_DIR", str(out))
    paths.reset()
    try:
        root = seed.ensure()
        assert root is not None
        assert (root / "courses" / "alpha" / "course.json").is_file()
        assert (root / "scripts" / "new-course.mjs").is_file()
    finally:
        paths.reset()


def real_pcm():
    for candidate in (os.environ.get("PCM_REPO"), str(Path(__file__).resolve().parents[2] / "Pentaho-Content-Manager")):
        if candidate and (Path(candidate) / "node_modules" / "lowlight").is_dir() and (Path(candidate) / "courses").is_dir():
            return Path(candidate)
    return None


@pytest.mark.skipif(real_pcm() is None, reason="needs a Content Manager checkout with npm install done")
def test_against_a_real_checkout_the_staged_tree_runs_the_real_verifier(tmp_path):
    pcm = real_pcm()
    first = sorted(p.name for p in (pcm / "courses").iterdir()
                   if (p / "course.json").is_file() and not p.name.startswith("_"))[0]
    res = stage(pcm, tmp_path / "seed", "--courses", first, check=True)
    assert res.returncode == 0, res.stdout + res.stderr
    assert "the staged tree runs the authoring scripts" in res.stdout
