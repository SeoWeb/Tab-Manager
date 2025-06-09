"use client";

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { BrainCircuit, Loader2 } from "lucide-react";
import { useAppStore } from '@/stores/appStore';
import { suggestCollectionName, type SuggestCollectionNameInput } from '@/ai/flows/suggest-collection-name';
import type { Link } from '@/types';
import { useToast } from "@/hooks/use-toast";


interface SuggestNameButtonProps {
  projectId: string;
  collectionId: string;
  currentLinks: Link[];
}

export default function SuggestNameButton({ projectId, collectionId, currentLinks }: SuggestNameButtonProps) {
  const { setCollectionName } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSuggestName = async () => {
    if (currentLinks.length === 0) {
      toast({
        title: "No links to analyze",
        description: "Add some links to this collection first to get a name suggestion.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const input: SuggestCollectionNameInput = {
        urls: currentLinks.map(link => link.url),
      };
      const result = await suggestCollectionName(input);
      if (result.collectionName) {
        setCollectionName(projectId, collectionId, result.collectionName);
        toast({
          title: "Name Suggested!",
          description: `Collection name updated to "${result.collectionName}".`,
        });
      } else {
         toast({
          title: "Suggestion Failed",
          description: "Could not suggest a name at this time.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error suggesting collection name:", error);
      toast({
        title: "Error",
        description: "An error occurred while suggesting a name.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={handleSuggestName}
      disabled={isLoading || currentLinks.length === 0}
      aria-label="Suggest collection name using AI"
      title="Suggest Name (AI)"
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
    </Button>
  );
}
