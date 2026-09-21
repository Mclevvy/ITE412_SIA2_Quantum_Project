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
  LogOutIcon // <-- Added the logout icon
} from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from './ui/sheet';
import { Button } from './ui/button';
import Logo from './Logo';

// Import Firebase Authentication functions
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase"; // Adjust path to your firebase config if needed

interface NavigationProps {
  currentScreen: string;
  setCurrentScreen: (screen: string) => void;
}

export default function Navigation({ currentScreen, setCurrentScreen }: NavigationProps) {
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

  // The Ghost Session Killer
  const handleLogout = () => {
    signOut(auth).then(() => {
      // Successfully destroyed the Firebase session token
      // Redirect the user back to the root login page
      window.location.replace("/"); 
    }).catch((error) => {
      console.error("Error logging out:", error);
    });
  };

  return (
    <>
      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
        <div className="w-full">
          <div className="flex items-center justify-around p-2">
            {mainNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentScreen === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentScreen(item.id)}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg min-w-[70px] transition-colors ${
                    isActive ? 'text-[#8B1538]' : 'text-gray-500'
                  }`}
                >
                  <Icon className={`w-6 h-6 mb-1 ${isActive ? 'fill-[#8B1538]' : ''}`} />
                  <span className="text-xs">{item.label}</span>
                </button>
              );
            })}
            
            {/* Menu Sheet Trigger */}
            <Sheet>
              <SheetTrigger asChild>
                <button className="flex flex-col items-center justify-center p-2 rounded-lg min-w-[70px] text-gray-500 hover:text-[#8B1538] transition-colors">
                  <MenuIcon className="w-6 h-6 mb-1" />
                  <span className="text-xs">More</span>
                </button>
              </SheetTrigger>
              
              <SheetContent side="bottom" className="max-w-md mx-auto rounded-t-3xl max-h-[90vh] overflow-y-auto">
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
                          className={`h-auto py-4 flex flex-col gap-2 ${
                            isActive ? 'bg-[#8B1538] hover:bg-[#6B1028] text-white' : 'hover:bg-gray-50'
                          }`}
                          onClick={() => setCurrentScreen(item.id)}
                        >
                          <Icon className="w-6 h-6" />
                          <span className="text-xs">{item.label}</span>
                        </Button>
                      </SheetClose>
                    );
                  })}
                </div>

                {/* SIGN OUT BUTTON SECTION */}
                <div className="mt-2 pt-4 border-t border-gray-100 pb-6">
                  <Button
                    variant="outline"
                    className="w-full py-6 text-red-600 border-red-100 hover:bg-red-50 hover:text-red-700 transition-colors"
                    onClick={handleLogout}
                  >
                    <LogOutIcon className="w-5 h-5 mr-2" />
                    Sign Out
                  </Button>
                  <p className="text-center text-xs text-gray-400 mt-3">
                    Logged in securely via Firebase
                  </p>
                </div>

              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </>
  );
}