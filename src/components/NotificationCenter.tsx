import { useState, useEffect } from 'react';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { 
  BellIcon, 
  AlertTriangleIcon, 
  CheckCircle2Icon, 
  InfoIcon,
  ThermometerIcon,
  CameraIcon,
  FlaskConicalIcon,
  Trash2Icon // ✅ Added Trash Icon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react'; // ✅ Imported Framer Motion

import { db } from '../lib/firebase';
import { get, limitToLast, onValue, query, ref, set, remove } from 'firebase/database';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// The node is never pruned by the writers, so cap every read: without this the
// app downloads an ever-growing list on every open.
const NOTIFICATION_READ_LIMIT = 50;

const iconMap: Record<string, any> = {
  ThermometerIcon,
  CheckCircle2Icon,
  FlaskConicalIcon,
  CameraIcon,
  AlertTriangleIcon,
  InfoIcon
};

interface AppNotification {
  id: string;
  type: 'warning' | 'success' | 'info';
  title: string;
  message: string;
  timestamp: number;
  iconName: string;
  unread: boolean;
}

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    if (!db) {
      setDbReady(false);
      return;
    }
    setDbReady(true);

    // Default key order (push IDs are chronologically monotonic), NOT
    // orderByChild('timestamp'): a locally written serverTimestamp() entry is
    // still pending, so it has no index value and sorted first — bypassing the
    // 24h filter below. The numeric-timestamp fallback in the mapper handles
    // the comparison instead.
    const notificationsQuery = query(
      ref(db, 'notifications'),
      limitToLast(NOTIFICATION_READ_LIMIT),
    );
    const cutoffTimestamp = Date.now() - ONE_DAY_MS;

    const unsubscribe = onValue(notificationsQuery, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const formattedData: AppNotification[] = Object.keys(data)
          .map(key => {
            const entry = data[key];
            // A locally written serverTimestamp() can still be pending, so
            // fall back to "now" instead of dropping the newest notification.
            const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : Date.now();
            return { id: key, ...entry, timestamp };
          })
          .filter(notif => notif.timestamp > cutoffTimestamp)
          .sort((a, b) => b.timestamp - a.timestamp);

        setNotifications(formattedData);
      } else {
        setNotifications([]);
      }
    });

    return () => unsubscribe();
  }, []);

  const unreadCount = notifications.filter(n => n.unread).length;
  const filteredNotifications = notifications.filter(n => {
    if (activeFilter === 'all') return true;
    return n.type === activeFilter;
  });

  // Action to mark a single notification as read
  const handleMarkAsRead = async (id: string) => {
    setNotifications(prev => prev.map(notif => notif.id === id ? { ...notif, unread: false } : notif));
    if (db) await set(ref(db, `notifications/${id}/unread`), false);
  };

  // ✅ ACTION: Delete a single notification (Triggered by Swipe)
  const handleDelete = async (id: string) => {
    // Optimistic UI update
    setNotifications(prev => prev.filter(notif => notif.id !== id));
    // Delete from Firebase
    if (db) await remove(ref(db, `notifications/${id}`));
  };

  // ✅ ACTION: Clear ALL Notifications
  // Also prunes entries older than 24h: they are already hidden by the list
  // filter above, so without this the node would only ever grow.
  const handleClearAll = async () => {
    if (!db) return;

    const idsToDelete = filteredNotifications.map(n => n.id);
    const cutoff = Date.now() - ONE_DAY_MS;

    const snap = await get(ref(db, 'notifications'));
    const stored = snap.exists() ? (snap.val() as Record<string, { timestamp?: number }>) : {};
    const staleIds = Object.keys(stored).filter(id => {
      const ts = stored[id]?.timestamp;
      return typeof ts !== 'number' || ts <= cutoff;
    });

    const allIds = Array.from(new Set([...idsToDelete, ...staleIds]));

    // Optimistic UI Update
    setNotifications(prev => prev.filter(n => !allIds.includes(n.id)));

    // Background Firebase Delete
    allIds.forEach(async (id) => {
       await remove(ref(db, `notifications/${id}`));
    });
  };

  const formatTimeAgo = (timestamp: number) => {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const diffInSeconds = (timestamp - Date.now()) / 1000;
    
    if (Math.abs(diffInSeconds) < 60) return rtf.format(Math.round(diffInSeconds), 'second');
    if (Math.abs(diffInSeconds) < 3600) return rtf.format(Math.round(diffInSeconds / 60), 'minute');
    if (Math.abs(diffInSeconds) < 86400) return rtf.format(Math.round(diffInSeconds / 3600), 'hour');
    return rtf.format(Math.round(diffInSeconds / 86400), 'day');
  };

  if (!dbReady) {
      return (
          <div className="p-4 text-center">
             <Card className="border-red-200 bg-red-50">
               <CardContent className="p-4">
                 <p className="text-sm text-destructive font-medium">Realtime Database not available</p>
               </CardContent>
             </Card>
          </div>
      );
  }

  return (
    <div className="p-4 space-y-4 pb-20 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-foreground font-bold text-xl">Notifications</h1>
          <p className="text-sm text-muted-foreground">Stay updated with your system</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="relative mt-1">
            <BellIcon aria-hidden="true" className="w-6 h-6 text-primary" />
            {unreadCount > 0 && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-destructive rounded-full flex items-center justify-center shadow-sm">
                <span className="text-xs text-white font-medium tnum">{unreadCount}</span>
              </div>
            )}
          </div>
          {/* ✅ CLEAR ALL BUTTON */}
          {filteredNotifications.length > 0 && (
            <button 
              onClick={handleClearAll}
              className="min-h-[44px] min-w-[44px] px-2 py-1 text-xs font-medium text-destructive bg-red-50 hover:bg-red-100 rounded-full transition-colors flex items-center gap-1"
            >
              <Trash2Icon aria-hidden="true" className="w-3 h-3" /> Clear All
            </button>
          )}
        </div>
      </div>

      {/* Filter Badges */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide" role="group" aria-label="Filter notifications">
        <Badge
          asChild
          variant={activeFilter === 'all' ? 'default' : 'outline'}
          className={`whitespace-nowrap cursor-pointer transition-colors rounded-full ${activeFilter === 'all' ? '' : 'hover:bg-accent'}`}
        >
          <button type="button" aria-pressed={activeFilter === 'all'} onClick={() => setActiveFilter('all')}>
            All ({notifications.length})
          </button>
        </Badge>
        <Badge
          asChild
          variant={activeFilter === 'warning' ? 'default' : 'outline'}
          className={`whitespace-nowrap cursor-pointer transition-colors rounded-full ${activeFilter === 'warning' ? '' : 'hover:bg-accent'}`}
        >
          <button type="button" aria-pressed={activeFilter === 'warning'} onClick={() => setActiveFilter('warning')}>
            Warnings ({notifications.filter(n => n.type === 'warning').length})
          </button>
        </Badge>
        <Badge
          asChild
          variant={activeFilter === 'success' ? 'default' : 'outline'}
          className={`whitespace-nowrap cursor-pointer transition-colors rounded-full ${activeFilter === 'success' ? '' : 'hover:bg-accent'}`}
        >
          <button type="button" aria-pressed={activeFilter === 'success'} onClick={() => setActiveFilter('success')}>
            Success ({notifications.filter(n => n.type === 'success').length})
          </button>
        </Badge>
      </div>

      {/* Notifications List */}
      <ScrollArea className="h-[calc(100vh-200px)] overflow-hidden">
        <div className="space-y-3 pb-4 overflow-hidden">
          {filteredNotifications.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 flex flex-col items-center">
              <BellIcon className="w-10 h-10 text-muted-foreground mb-3" />
              <p>No new notifications.</p>
            </div>
          ) : (
            <AnimatePresence>
              {filteredNotifications.map((notification) => {
                const Icon = iconMap[notification.iconName] || InfoIcon;
                
                const typeColors = {
                  warning: 'bg-amber-50 text-amber-700 border-amber-200',
                  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  info: 'bg-blue-50 text-blue-700 border-blue-200',
                };

                return (
                  // ✅ SWIPE TO DELETE WRAPPER
                  <motion.div
                    key={notification.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, x: -100, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                    className="relative rounded-xl overflow-hidden"
                  >
                    {/* The Red Background that shows when swiping */}
                    <div className="absolute inset-0 bg-red-500 flex items-center justify-end px-6 rounded-xl">
                      <Trash2Icon aria-hidden="true" className="text-white w-6 h-6" />
                    </div>

                    {/* The Draggable Notification Card */}
                    <motion.div
                      drag="x"
                      dragConstraints={{ left: 0, right: 0 }}
                      // Only allow swiping to the left
                      dragElastic={{ left: 0.5, right: 0 }} 
                      onDragEnd={(e, info) => {
                        // If they swipe left past 100px, trigger delete
                        if (info.offset.x < -100) {
                          handleDelete(notification.id);
                        }
                      }}
                      className="relative bg-card rounded-2xl"
                      whileTap={{ cursor: "grabbing" }}
                    >
                      <Card
                        onClick={() => handleMarkAsRead(notification.id)}
                        className={`
                          ${notification.unread ? 'border-primary border-l-4 cursor-pointer shadow-sm' : 'opacity-70'} 
                          transition-all hover:shadow-md
                        `}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${typeColors[notification.type] || typeColors.info}`}>
                              <Icon className="w-5 h-5" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <p className={`text-foreground ${notification.unread ? 'font-semibold' : ''}`}>
                                  {notification.title}
                                </p>
                                {notification.unread && (
                                  <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5" />
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">{notification.message}</p>
                              <div className="flex items-center justify-between gap-2 mt-2">
                                <p className="text-xs text-muted-foreground">{formatTimeAgo(notification.timestamp)}</p>
                                {/* Visible delete: swipe is an enhancement, keyboard/SR users need a real control. */}
                                <button
                                  type="button"
                                  aria-label="Delete notification"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(notification.id);
                                  }}
                                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                                >
                                  <Trash2Icon aria-hidden="true" className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}