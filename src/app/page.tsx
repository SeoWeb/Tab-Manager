import AppClient from '@/components/AppClient';
import MainLayout from '@/components/MainLayout/MainLayout';

export default function Home() {
  return (
    <MainLayout>
      {/* Content for the main panel of MainLayout */}
      <h1 className='text-2xl font-bold mb-4'>
        Tab Manager Extension - Main View
      </h1>
      <AppClient />
    </MainLayout>
  );
}
