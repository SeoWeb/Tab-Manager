
import AppClient from "@/components/AppClient";
import { SidebarProvider } from "@/components/ui/sidebar"; // Added

export default function Home() {
  return (
    <SidebarProvider> {/* Added wrapper */}
      {/* Original h1 can be removed if AppClient or its children provide the main view title/content */}
      {/* For now, let's keep the AppClient as the sole child of SidebarProvider */}
      <AppClient />
    </SidebarProvider>
  );
}
