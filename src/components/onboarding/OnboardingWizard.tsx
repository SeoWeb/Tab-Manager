'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { FolderKanban, FolderOpen, Link2 } from 'lucide-react';

interface Step {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  content: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to TabSpace',
    description: "Let's take a quick tour of how things are organized.",
    content:
      'TabSpace helps you organize your browsing into a simple hierarchy. This quick tour explains the three core building blocks so you can get the most out of it. You can skip at any time.',
  },
  {
    title: 'Projects',
    description: 'The top-level container for everything you organize.',
    icon: FolderKanban,
    content:
      'A Project is the highest level of organization — think of it as a workspace for a goal, client, or area of your life (e.g. "Work", "Personal", "Research"). Each project keeps its own collections and links separate and easy to find.',
  },
  {
    title: 'Collections',
    description: 'Groups of related links inside a project.',
    icon: FolderOpen,
    content:
      'A Collection lives inside a Project and groups related links together — like folders within a project. For example, a "Work" project might have collections for "Reading List", "References", and "Daily Tabs".',
  },
  {
    title: 'Links & Quick Links',
    description: 'The actual saved pages and your fast-access bar.',
    icon: Link2,
    content:
      'Links are the individual pages you save inside a collection. Quick Links are a global, always-available bar of your most important destinations, accessible from any project. Together they make up the bottom of the hierarchy: Projects → Collections → Links.',
  },
  {
    title: "You're all set",
    description: 'Start organizing your tabs with confidence.',
    content:
      "That's the core of TabSpace: Projects hold Collections, and Collections hold Links — with Quick Links available everywhere. Dive in, and revisit this tour anytime from Settings.",
  },
];

const TOTAL_STEPS = STEPS.length;

export default function OnboardingWizard() {
  const isOnboardingOpen = useAppStore((state) => state.isOnboardingOpen);
  const completeOnboarding = useAppStore((state) => state.completeOnboarding);
  const [step, setStep] = useState(0);

  const current = STEPS[step];
  const isFirstStep = step === 0;
  const isLastStep = step === TOTAL_STEPS - 1;
  const StepIcon = current.icon;

  const handleNext = () => {
    if (!isLastStep) {
      setStep((s) => s + 1);
    } else {
      completeOnboarding();
    }
  };

  const handleBack = () => {
    if (!isFirstStep) {
      setStep((s) => s - 1);
    }
  };

  const handleOpenChange = (open: boolean) => {
    // The wizard is only closed via Skip or Get started, which call
    // completeOnboarding. Ignore programmatic close attempts here so the
    // dialog can't be dismissed by the overlay or escape (handled below).
    if (!open) return;
  };

  return (
    <Dialog open={isOnboardingOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className='sm:max-w-[520px]'
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.description}</DialogDescription>
        </DialogHeader>

        <Progress value={((step + 1) / TOTAL_STEPS) * 100} className='w-full' />

        {StepIcon ? (
          <Card>
            <CardHeader className='flex-row items-center gap-3 space-y-0'>
              <StepIcon className='h-6 w-6 text-primary' />
              <CardTitle className='text-base'>{current.title}</CardTitle>
            </CardHeader>
            <CardContent className='text-sm text-muted-foreground'>
              {current.content}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className='pt-6 text-sm text-muted-foreground'>
              {current.content}
            </CardContent>
          </Card>
        )}

        <div className='flex items-center justify-between gap-2 pt-2'>
          <div>
            {!isFirstStep && (
              <Button variant='ghost' onClick={handleBack}>
                Back
              </Button>
            )}
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='outline' onClick={completeOnboarding}>
              Skip
            </Button>
            <Button onClick={handleNext}>
              {isLastStep ? 'Get started' : 'Next'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
