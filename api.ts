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

export interface StructureLab {
  slug: string;
  title: string;
  kind: "workshop" | "page";
}

export interface StructureTopic {
  title: string;
  labs: StructureLab[];
}

export interface Structure {
  topics: StructureTopic[];
}

export type Provider = "ollama" | "anthropic" | "openai";

export interface Settings {
  provider: Provider;
  ollama: { url: string; model: string };
  anthropic: { model: string };
  openai: { model: string };
  keys: { anthropic: boolean; openai: boolean };
  ollamaModels: string[];
}

export interface ProviderHealth {
  provider: Provider;
  ok: boolean;
  model: string;
  detail: string;
  models?: string[];
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

  async createCourse(title: string, kind: "workshop" | "academy"): Promise<CourseSummary> {
    return json(
      await fetch(`${API_BASE}/api/courses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind }),
      }),
    );
  },

  async verifyCourse(course: string): Promise<{ ok: boolean; output: string }> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/verify`, { method: "POST" }),
    );
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

  async getStructure(course: string): Promise<Structure> {
    return json(await fetch(`${API_BASE}/api/courses/${course}/structure`));
  },

  async putStructure(course: string, structure: Structure): Promise<Structure> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/structure`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(structure),
      }),
    );
  },

  async ollamaHealth(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    return json(await fetch(`${API_BASE}/api/ollama/health`));
  },

  async getSettings(): Promise<Settings> {
    return json(await fetch(`${API_BASE}/api/settings`));
  },

  async putSettings(patch: Partial<Omit<Settings, "keys" | "ollamaModels">>): Promise<Settings> {
    return json(
      await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  },

  async providerHealth(): Promise<ProviderHealth> {
    return json(await fetch(`${API_BASE}/api/providers/health`));
  },

  async generateLab(
    course: string,
    title: string,
    outline: string,
    topic: string,
    kind: "workshop" | "page",
  ): Promise<{ slug: string; structure: Structure }> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/generate-lab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, outline, topic, kind }),
      }),
    );
  },

  async createLab(
    course: string,
    title: string,
    topic: string,
    kind: "workshop" | "page",
  ): Promise<Structure> {
    return json(
      await fetch(`${API_BASE}/api/courses/${course}/labs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, topic, kind }),
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
