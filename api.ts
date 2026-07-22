// Thin client for the course-editor FastAPI backend (editor/api/app.py).
// The base URL is configurable via VITE_EDITOR_API but defaults to the
// local uvicorn dev port.

const API_BASE =
  (import.meta as any).env?.VITE_EDITOR_API ?? "http://localhost:8000";

export interface CourseSummary {
  id: string;
  title: string;
}

export interface LabSummary {
  slug: string;
  title: string;
  order: number;
  kind: "workshop" | "page";
}

export interface LabDetail {
  slug: string;
  body: string;
  manifest: Record<string, unknown>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = (data as any).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  base: API_BASE,

  async health(): Promise<{ ok: boolean; coursesDir: string }> {
    return json(await fetch(`${API_BASE}/api/health`));
  },

  async listCourses(): Promise<CourseSummary[]> {
    return json(await fetch(`${API_BASE}/api/courses`));
  },

  async listLabs(course: string): Promise<LabSummary[]> {
    return json(await fetch(`${API_BASE}/api/courses/${course}/labs`));
  },

  async getLab(course: string, lab: string): Promise<LabDetail> {
    return json(await fetch(`${API_BASE}/api/courses/${course}/labs/${lab}`));
  },

  async saveLab(
    course: string,
    lab: string,
    body: string,
    manifest?: Record<string, unknown>,
  ): Promise<LabDetail> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/labs/${lab}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, manifest }),
      }),
    );
  },

  /** Base URL the preview should use for a lab's relative asset refs.
   *  Mirrors the packaged app: refs like `../_assets/images/x.png` and
   *  `files/y.png` resolve correctly against `<course>/tree/<lab>/`. */
  assetBaseUrl(course: string, lab: string): string {
    return `${API_BASE}/api/courses/${course}/tree/${lab}/`;
  },
};
