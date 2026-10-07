import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications';
import {
  LocalNotifications,
  type LocalNotificationSchema,
} from '@capacitor/local-notifications';
import { get, ref, remove, update } from 'firebase/database';
import { auth, db } from './firebase';

const DEVICE_TOKEN_ROOT = 'deviceTokens';

// --- Singleton guard: ensures native registration only ever happens once ---
let pushInitPromise: Promise<() => Promise<void>> | null = null;

function notificationFromPush(push: PushNotificationSchema): LocalNotificationSchema {
  const data = push.data ?? {};
  const id = Math.abs(
    Array.from(`${push.id ?? Date.now()}${data.notificationId ?? ''}`).reduce(
      (hash, character) => (hash * 31 + character.charCodeAt(0)) | 0,
      0,
    ),
  );

  return {
    id: id || Date.now(),
    title: push.title ?? data.title ?? 'FERMA notification',
    body: push.body ?? data.message ?? 'You have a new system notification.',
    schedule: { at: new Date(Date.now() + 250) },
    sound: 'default',
    extra: data,
  };
}

async function saveDeviceToken(token: Token) {
  const user = auth.currentUser;
  if (!user || !db) {
    console.warn('[push] cannot save token — user or db missing', { hasUser: !!user, hasDb: !!db });
    return;
  }

  const devicePath = `${DEVICE_TOKEN_ROOT}/${user.uid}`;
  const key = encodeURIComponent(token.value);

  // Token rotation: FCM can hand back a new token for the same install, and a
  // stale sibling key would keep this device receiving pushes forever. One
  // atomic update — read-then-remove-then-set raced against a concurrent
  // registration and could resurrect a stale key.
  const existingSnap = await get(ref(db, devicePath));
  const staleKeys = Object.keys(existingSnap.val() ?? {}).filter((k) => k !== key);

  await update(ref(db, devicePath), {
    [key]: {
      token: token.value,
      platform: Capacitor.getPlatform(),
      updatedAt: Date.now(),
    },
    ...Object.fromEntries(staleKeys.map((k) => [k, null])),
  });
}

/**
 * Drops this account's FCM token(s) from the database. Call on sign-out —
 * otherwise a shared device keeps delivering the previous user's pushes to
 * whoever signs in next.
 */
export async function clearDeviceTokens(uid: string): Promise<void> {
  if (!db) return;
  try {
    await remove(ref(db, `${DEVICE_TOKEN_ROOT}/${uid}`));
  } catch (error) {
    console.warn('[push] failed to clear device tokens', error);
  }
}

async function actuallyInitializePushNotifications(): Promise<() => Promise<void>> {
  if (import.meta.env.DEV) console.log('[push] init started');

  if (!Capacitor.isNativePlatform()) {
    if (import.meta.env.DEV) console.log('[push] not native platform, skipping');
    return async () => undefined;
  }

  const permission = await PushNotifications.checkPermissions();
  if (import.meta.env.DEV) console.log('[push] current permission:', permission.receive);

  if (permission.receive !== 'granted') {
    const requested = await PushNotifications.requestPermissions();
    if (import.meta.env.DEV) console.log('[push] requested permission result:', requested.receive);
    if (requested.receive !== 'granted') {
      console.warn('[push] permission denied, aborting');
      return async () => undefined;
    }
  }

  const localPermission = await LocalNotifications.checkPermissions();
  if (localPermission.display !== 'granted') {
    await LocalNotifications.requestPermissions();
  }

  const registration = await PushNotifications.addListener('registration', async (token) => {
    try {
      await saveDeviceToken(token);
    } catch (error) {
      console.error('[push] FAILED to save token to Firebase:', error);
    }
  });

  const registrationError = await PushNotifications.addListener('registrationError', (error) => {
    console.error('[push] NATIVE registration error:', JSON.stringify(error));
  });

  const received = await PushNotifications.addListener(
    'pushNotificationReceived',
    async (push) => {
      try {
        await LocalNotifications.schedule({ notifications: [notificationFromPush(push)] });
      } catch (error) {
        console.warn('[push] foreground notification failed', error);
      }
    },
  );

  if (import.meta.env.DEV) console.log('[push] calling PushNotifications.register()...');
  await PushNotifications.register();
  if (import.meta.env.DEV) console.log('[push] register() call completed');

  // Note: listeners are intentionally never removed here. Since this only
  // ever runs once per app lifetime (guarded below), there's nothing to
  // tear down — removing them on a StrictMode "cleanup" is exactly what
  // caused the dropped-token bug in the first place.
  return async () => undefined;
}

/**
 * Registers the current native device with FCM/APNs and displays foreground
 * pushes as local notifications. Safe to call from multiple component mounts
 * (e.g. React StrictMode) — the actual native registration only ever runs once.
 */
export async function initializePushNotifications(): Promise<() => Promise<void>> {
  if (!pushInitPromise) {
    pushInitPromise = actuallyInitializePushNotifications();
  }
  return pushInitPromise;
}