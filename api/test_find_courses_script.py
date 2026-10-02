"""The installer's checkout search (desktop/scripts/find-courses.ps1).

Run for real, under Windows PowerShell, against checkouts built in a temp
directory. `-ReportOnly` stops it before the registry write, which needs
elevation, and `-Roots` stops it looking at this machine's own checkouts.

The case that prompted these: the dev machine held the main Content
Manager checkout and a git worktree of it (C:\\Projects\\pcm-060) on a
release branch. The search broke the tie by PATH, alphabetically, and
"pcm-060" sorts before "Pentaho-Content-Manager", so the installed editor
opened the stale worktree, where a Publish would have pushed older exams
over the rewritten ones. The Exam Bank's copy of this search had the same
fault (its 7e8bb90); these tests follow its own.
"""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "desktop" / "scripts" / "find-courses.ps1"
POWERSHELL = shutil.which("powershell.exe")

pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or POWERSHELL is None,
    reason="the installer runs this under Windows PowerShell",
)


def checkout(root, name, git="dir", scripts=True):
    """A directory with courses/ in it, which is all this search requires.

    git="dir" is a main checkout, git="file" a worktree (its .git is a file
    naming the real repository), git=None a copy with no git at all.
    scripts=True adds the scaffolder, which ranks a checkout higher.
    """
    repo = root / name
    (repo / "courses" / "a-course").mkdir(parents=True)
    if scripts:
        (repo / "scripts").mkdir()
        (repo / "scripts" / "new-course.mjs").write_text("// scaffolder", encoding="utf-8")
    if git == "dir":
        (repo / ".git").mkdir()
    elif git == "file":
        (repo / ".git").write_text(
            f"gitdir: C:/elsewhere/.git/worktrees/{name}\n", encoding="utf-8"
        )
    return repo


def search(root):
    result = subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass",
         "-File", str(SCRIPT), "-Roots", str(root), "-ReportOnly"],
        capture_output=True, text=True, timeout=60,
    )
    return result.returncode, result.stdout


def recorded(stdout):
    """The path the search would record, from its report line."""
    for line in stdout.splitlines():
        if line.startswith("Would record "):
            return line[len("Would record "):].rsplit(" under ", 1)[0]
    raise AssertionError(f"no 'Would record' line in:\n{stdout}")


def test_a_main_checkout_beats_a_worktree_that_sorts_first(tmp_path):
    """The dev machine, exactly: pcm-060 sorts before Pentaho-Content-Manager."""
    main = checkout(tmp_path, "Pentaho-Content-Manager")
    worktree = checkout(tmp_path, "pcm-060", git="file")

    code, out = search(tmp_path)

    assert code == 0, out
    assert recorded(out) == str(main)
    assert f"Passed over git worktree {worktree}." in out, (
        "the install log must say why the worktree was not chosen"
    )


def test_a_main_checkout_beats_a_worktree_even_if_only_the_worktree_can_scaffold(tmp_path):
    """Editing a stale branch is the danger; a checkout that can only edit
    is the safer default, and the author can still change it on first run."""
    main = checkout(tmp_path, "courses-only", scripts=False)
    checkout(tmp_path, "pcm-060", git="file")

    code, out = search(tmp_path)

    assert code == 0, out
    assert recorded(out) == str(main)


def test_a_copy_without_git_is_not_taken_for_a_worktree(tmp_path):
    copy = checkout(tmp_path, "zz-copy", git=None)
    checkout(tmp_path, "pcm-060", git="file")

    code, out = search(tmp_path)

    assert code == 0, out
    assert recorded(out) == str(copy)


def test_a_worktree_alone_is_still_recorded(tmp_path):
    """Demoted, not refused: a worktree's courses beat asking on first run."""
    worktree = checkout(tmp_path, "pcm-060", git="file")

    code, out = search(tmp_path)

    assert code == 0, out
    assert recorded(out) == str(worktree)


def test_scaffolding_still_wins_between_main_checkouts(tmp_path):
    checkout(tmp_path, "Pentaho-Content-Manager", scripts=False)
    full = checkout(tmp_path, "zz-full-clone")

    code, out = search(tmp_path)

    assert code == 0, out
    assert recorded(out) == str(full)


def test_a_tie_goes_to_the_named_checkout_not_the_alphabet(tmp_path):
    """The named folder is looked at first and the comment always said the
    first found wins a tie; sorting by Path gave it to "another-clone"."""
    named = checkout(tmp_path, "Pentaho-Content-Manager")
    checkout(tmp_path, "another-clone")

    code, out = search(tmp_path)

    assert code == 0, out
    assert recorded(out) == str(named)


def test_nothing_found_exits_1_quietly(tmp_path):
    (tmp_path / "not-a-checkout").mkdir()

    code, out = search(tmp_path)

    assert code == 1
    assert "No Content Manager checkout found" in out
