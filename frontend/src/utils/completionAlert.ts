export type CompletionAlertOptions = {
  title: string;
  body: string;
  blinkTitle?: string;
  tag?: string;
  playSound?: boolean;
  icon?: string;
};

export type CompletionAlertController = {
  stopBlink: () => void;
  stop: () => void;
};

const BLINK_MS = 1000;

let activeAlert: CompletionAlertController | null = null;

export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  if (Notification.permission === 'default') {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  return Notification.permission;
}

function playCompletionChime(): void {
  if (typeof window === 'undefined') return;
  const AC =
    window.AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;

  try {
    const ctx = new AC();
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    };

    void ctx.resume().then(() => {
      const t0 = ctx.currentTime;
      playTone(880, t0, 0.12);
      playTone(1174.7, t0 + 0.14, 0.18);
      window.setTimeout(() => {
        void ctx.close().catch(() => undefined);
      }, 500);
    });
  } catch {
    // autoplay blocked or unsupported
  }
}

function defaultNotificationIcon(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return new URL('/images/logos/logo.webp', window.location.origin).href;
  } catch {
    return undefined;
  }
}

function showDesktopNotification(
  options: CompletionAlertOptions,
): Notification | null {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return null;
  }
  if (Notification.permission !== 'granted') {
    return null;
  }

  const icon = options.icon ?? defaultNotificationIcon();
  try {
    const notification = new Notification(options.title, {
      body: options.body,
      tag: options.tag ?? 'minuspod-recut-complete',
      requireInteraction: true,
      silent: false,
      ...(icon ? { icon } : {}),
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore
      }
      notification.close();
    };
    return notification;
  } catch {
    return null;
  }
}

export function stopActiveCompletionAlert(): void {
  activeAlert?.stop();
  activeAlert = null;
}

export function startCompletionAlert(
  options: CompletionAlertOptions,
): CompletionAlertController {
  stopActiveCompletionAlert();

  const blinkTitle = options.blinkTitle ?? 'Recut complete';
  const originalTitle =
    typeof document !== 'undefined' ? document.title : '';
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let showingAlertTitle = false;
  let notification: Notification | null = null;
  let stopped = false;

  const stopBlink = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (typeof document !== 'undefined' && originalTitle) {
      document.title = originalTitle;
    }
    showingAlertTitle = false;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopBlink();
    if (notification) {
      try {
        notification.close();
      } catch {
        // ignore
      }
      notification = null;
    }
    if (activeAlert === controller) {
      activeAlert = null;
    }
  };

  if (options.playSound !== false) {
    playCompletionChime();
  }

  notification = showDesktopNotification(options);

  if (typeof document !== 'undefined') {
    intervalId = setInterval(() => {
      showingAlertTitle = !showingAlertTitle;
      document.title = showingAlertTitle ? blinkTitle : originalTitle;
    }, BLINK_MS);
  }

  const controller: CompletionAlertController = { stopBlink, stop };
  activeAlert = controller;
  return controller;
}
