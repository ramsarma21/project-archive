export const PRESENTATION_NOTICE_EVENT = "pa:presentation-notice";

export type PresentationNoticeKind =
  | "CINEMATIC_DIALOGUE"
  | "REACTIVE_FEEDBACK"
  | "ARCHIVE_NOTICE"
  | "CHASE"
  | "ROUTE_WARNING"
  | "EAVESDROP"
  | "FLAVOR"
  | "AMBIENT";

export const PRESENTATION_NOTICE_PRIORITY: Readonly<
  Record<PresentationNoticeKind, number>
> = {
  CINEMATIC_DIALOGUE: 800,
  REACTIVE_FEEDBACK: 700,
  ARCHIVE_NOTICE: 600,
  CHASE: 550,
  ROUTE_WARNING: 500,
  EAVESDROP: 300,
  FLAVOR: 200,
  AMBIENT: 100,
};

export interface PresentationNotice {
  id: string;
  kind: PresentationNoticeKind;
  speaker?: string;
  text: string;
  durationMs?: number;
  dedupeKey?: string;
  cooldownMs?: number;
  captions: boolean;
}

export interface ActivePresentationNotice extends PresentationNotice {
  shownAt: number;
  expiresAt: number;
}

export function dispatchPresentationNotice(
  notice: PresentationNotice,
): void {
  window.dispatchEvent(
    new CustomEvent<PresentationNotice>(PRESENTATION_NOTICE_EVENT, {
      detail: notice,
    }),
  );
}

export class PresentationNoticeArbiter {
  private active: ActivePresentationNotice | null = null;
  private readonly lastShown = new Map<string, number>();

  offer(
    notice: PresentationNotice,
    now = performance.now(),
  ): ActivePresentationNotice | null {
    if (!notice.id || !notice.text.trim() || !notice.captions) {
      return this.current(now);
    }
    const dedupeKey = notice.dedupeKey ?? notice.id;
    const cooldown = notice.cooldownMs ?? 4_000;
    const previous = this.lastShown.get(dedupeKey);
    if (previous !== undefined && now - previous < cooldown) {
      return this.current(now);
    }
    const current = this.current(now);
    if (
      current &&
      PRESENTATION_NOTICE_PRIORITY[current.kind] >
        PRESENTATION_NOTICE_PRIORITY[notice.kind]
    ) {
      return current;
    }
    const duration = Math.max(900, Math.min(8_000, notice.durationMs ?? 3_200));
    this.lastShown.set(dedupeKey, now);
    this.active = {
      ...notice,
      shownAt: now,
      expiresAt: now + duration,
    };
    return this.active;
  }

  current(now = performance.now()): ActivePresentationNotice | null {
    if (this.active && this.active.expiresAt <= now) {
      this.active = null;
    }
    return this.active;
  }

  clear(id?: string): void {
    if (!id || this.active?.id === id) this.active = null;
  }
}

