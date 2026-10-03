"""What a course may never carry: a secret.

Courses are published to a PUBLIC repository (Pentaho-Courses), and since
Content Manager 0.7.2 every secret the learner app needs reaches the
machine another way: the course installer or the VM's provisioning, from
a private secrets file (the Content Manager's docs/SECRETS.md). So a save
that would write a secret into course.json or exam.json is refused here,
before it can ever be published.

The Python twin of the Content Manager's scripts/lib/published-secrets.mjs,
which verify-course applies to the same files. Keep the two patterns in
step. Reports key PATHS, never values.
"""
from __future__ import annotations

import re
from typing import Any

#: A key whose non-empty string value is a credential.
SECRET_KEY = re.compile(r"(secret|password|passwd|token|api[_-]?key)$", re.I)

#: A URL carrying its credential in the query: an Azure Logic App's
#: ``sig=``, an Azure Function's ``code=``.
URL_CREDENTIAL = re.compile(r"[?&](sig|code|key|token|api[_-]?key|access[_-]?token)=[^&#\s]+", re.I)


def published_secrets(doc: Any, path: str = "") -> list[str]:
    """Every secret in a JSON-like value, as dotted key paths."""
    found: list[str] = []
    if isinstance(doc, list):
        for i, v in enumerate(doc):
            found += published_secrets(v, f"{path}[{i}]")
    elif isinstance(doc, dict):
        for key, value in doc.items():
            p = f"{path}.{key}" if path else str(key)
            if isinstance(value, str) and value.strip():
                if SECRET_KEY.search(str(key)):
                    found.append(p)
                elif re.match(r"https?://", value.strip(), re.I) and URL_CREDENTIAL.search(value):
                    found.append(p)
            found += published_secrets(value, p)
    return found


def refusal(found: list[str]) -> str:
    """The 400 message for a save that carries secrets."""
    return (
        f"{', '.join(found)}: course files are published, so secrets never go in them. "
        "Put the value in the machine secrets file the installers and provisioning "
        "deliver (Content Manager docs/SECRETS.md)."
    )
