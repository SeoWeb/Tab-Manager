"use client";

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PlusCircle, Trash2, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import { getFaviconUrl, isValidUrl } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

export default function OpenTabsPanelContent() {
  const { quickLinks, addQuickLink, removeQuickLink } = useAppStore();
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');

  const handleAddLink = () => {
    if (isValidUrl(newLinkUrl)) {
      addQuickLink({ title: newLinkTitle || newLinkUrl, url: newLinkUrl });
      setNewLinkUrl('');
      setNewLinkTitle('');
    } else {
      alert("Please enter a valid URL.");
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">Quick Links</h3>
      
      <Card>
        <CardContent className="p-4 space-y-3">
          <Input
            type="text"
            placeholder="Link Title (optional)"
            value={newLinkTitle}
            onChange={(e) => setNewLinkTitle(e.target.value)}
            className="text-sm"
          />
          <Input
            type="url"
            placeholder="https://example.com"
            value={newLinkUrl}
            onChange={(e) => setNewLinkUrl(e.target.value)}
            className="text-sm"
          />
          <Button onClick={handleAddLink} size="sm" className="w-full">
            <PlusCircle className="mr-2 h-4 w-4" /> Add Quick Link
          </Button>
        </CardContent>
      </Card>

      {quickLinks.length > 0 ? (
        <div className="space-y-2">
          {quickLinks.map((link) => (
            <div key={link.id} className="flex items-center gap-2 p-2 bg-secondary/30 rounded-md border border-input text-sm">
              <Image 
                src={getFaviconUrl(link.url)} 
                alt="favicon" 
                width={16} 
                height={16} 
                className="rounded shrink-0"
                onError={(e) => (e.currentTarget.src = 'https://placehold.co/16x16.png')}
                unoptimized
              />
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-primary hover:underline" title={link.url}>
                {link.title}
              </a>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeQuickLink(link.id)}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">No quick links added yet.</p>
      )}
    </div>
  );
}
