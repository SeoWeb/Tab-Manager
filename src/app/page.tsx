
import AppClient from "@/components/AppClient";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function Home() {
  return (
    <SidebarProvider defaultOpen={true}>
      <AppClient />
    </SidebarProvider>
  );
}
