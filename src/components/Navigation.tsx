import { 
  HomeIcon, 
  ScanLineIcon,
  TrendingUpIcon,
  BellIcon,
  BarChart3Icon,
  SparklesIcon,
  CpuIcon,
  MenuIcon,
  DropletsIcon,
  LogOutIcon, // <-- Added the logout icon
  LockIcon
} from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from './ui/sheet';
import { Button } from './ui/button';
import Logo from './Logo';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { hasPinFor, clearPin, clearTrust } from '../lib/pinLock';

// Import Firebase Authentication functions
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase"; // Adjust path to your firebase config if needed
import { clearDeviceTokens } from "../lib/pushNotifications";

interface NavigationProps {
  currentScreen: string;
  onNavigate: (screen: string) => void;
  onManagePin: () => void;
}

export default function Navigation({ currentScreen, onNavigate, onManagePin }: NavigationProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const pinOn = hasPinFor(user?.uid);
  const mainNavItems = [
    { id: 'dashboard', icon: HomeIcon, label: 'Home' },
    { id: 'sorting', icon: ScanLineIcon, label: 'Sorting' },
    { id: 'notifications', icon: BellIcon, label: 'Alerts' },
  ];

  const menuItems = [
    { id: 'dashboard', icon: HomeIcon, label: 'Dashboard' },
    { id: 'sorting', icon: ScanLineIcon, label: 'Fruit Sorting' },
    { id: 'fermentation', icon: TrendingUpIcon, label: 'Fermentation' },
    { id: 'filling', icon: DropletsIcon, label: 'Bottle Filling' },
    { id: 'notifications', icon: BellIcon, label: 'Notifications' },
    { id: 'reports', icon: BarChart3Icon, label: 'Reports' },
    { id: 'insights', icon: SparklesIcon, label: 'AI Insights' },
    { id: 'devices', icon: CpuIcon, label: 'Devices' },
  ];

  // The Ghost Session Killer — destroys the trusted-device session too,
  // so the next launch requires the full email+password sign-in again.
  const handleLogout = () => {
    // Must run while still authenticated: the rules for deviceTokens require
    // auth.uid === $uid, so this write is denied after signOut completes.
    // Awaited first — otherwise the delete can lose the race against signOut.
    const uid = user?.uid;
    (uid ? clearDeviceTokens(uid) : Promise.resolve()).then(() => {
      signOut(auth).then(() => {
        clearPin();
        clearTrust();
        // SPA navigation keeps the app shell alive instead of a full reload.
        navigate("/", { replace: true });
      }).catch((error) => {
        console.error("Error logging out:", error);
      });
    });
  };

  return (
    <>
      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur-md border-t border-primary/10 z-50 pb-safe">
        <div className="w-full max-w-xl mx-auto">
          <div className="flex items-center justify-around p-2">
            {mainNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentScreen === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={item.label}
                  className={`flex flex-col items-center justify-center px-3 py-2 rounded-2xl min-w-[70px] transition-all ${
                    isActive ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon aria-hidden="true" className={`w-6 h-6 mb-1 ${isActive ? 'fill-primary' : ''}`} />
                  <span className="text-xs">{item.label}</span>
                </button>
              );
            })}
            
            {/* Menu Sheet Trigger */}
            <Sheet>
              <SheetTrigger asChild>
                <button className="flex flex-col items-center justify-center px-3 py-2 rounded-2xl min-w-[70px] text-muted-foreground hover:text-primary transition-colors" aria-label="More options">
                  <MenuIcon aria-hidden="true" className="w-6 h-6 mb-1" />
                  <span className="text-xs">More</span>
                </button>
              </SheetTrigger>
              
              <SheetContent side="bottom" className="max-w-md mx-auto rounded-t-3xl max-h-[90vh] overflow-y-auto px-4 sm:px-6 pb-5">
                <SheetHeader className="flex flex-col items-center">
                  <Logo size="md" className="mb-2" />
                  <SheetTitle>All Features</SheetTitle>
                  <SheetDescription>
                    Navigate to different sections of the app
                  </SheetDescription>
                </SheetHeader>
                
                {/* Main Menu Grid */}
                <div className="grid grid-cols-2 gap-3 mt-6 pb-4">
                  {menuItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentScreen === item.id;
                    
                    return (
                      <SheetClose asChild key={item.id}>
                        <Button
                          variant={isActive ? "default" : "outline"}
                          className="h-auto min-h-[92px] py-4 flex flex-col items-center justify-center gap-2 text-center leading-tight"
                          onClick={() => onNavigate(item.id)}
                        >
                          <Icon aria-hidden="true" className="w-6 h-6 shrink-0" />
                          <span className="text-xs">{item.label}</span>
                        </Button>
                      </SheetClose>
                    );
                  })}
                </div>

                {/* SIGN OUT BUTTON SECTION */}
                <div className="mt-2 pt-4 border-t border-border pb-2">
                  <Button
                    variant="outline"
                    className="w-full py-6 text-red-600 border-red-100 hover:bg-red-50 hover:text-red-700 transition-colors"
                    onClick={handleLogout}
                  >
                    <LogOutIcon aria-hidden="true" className="w-5 h-5 mr-2" />
                    Sign Out
                  </Button>
                  <SheetClose asChild>
                    <Button
                      variant="ghost"
                      className="w-full mt-1 text-muted-foreground hover:text-primary justify-between rounded-2xl"
                      onClick={onManagePin}
                    >
                      <span className="flex items-center gap-2">
                        <LockIcon aria-hidden="true" className="w-4 h-4" />
                        App PIN
                      </span>
                      <span className={`text-xs font-semibold ${pinOn ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                        {pinOn ? 'On' : 'Off'}
                      </span>
                    </Button>
                  </SheetClose>
                </div>

              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </>
  );
}