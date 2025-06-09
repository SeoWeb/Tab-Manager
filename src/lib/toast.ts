import { toast } from '@/hooks/use-toast';

export const showErrorToast = (message: string) => {
  toast({
    title: 'Error',
    description: message,
    variant: 'destructive',
  });
};

export const showSuccessToast = (message: string) => {
  toast({
    title: 'Success',
    description: message,
  });
};
