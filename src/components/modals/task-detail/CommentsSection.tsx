'use client';

import { MessageSquare } from 'lucide-react';
import type { AdvancedTask } from '@/types/tasks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface CommentsSectionProps {
  comments: AdvancedTask['comments'];
  newComment: string;
  onNewCommentChange: (value: string) => void;
  onAddComment: () => void;
}

export function CommentsSection({
  comments,
  newComment,
  onNewCommentChange,
  onAddComment,
}: CommentsSectionProps) {
  return (
    <div>
      <h3 className='font-semibold mb-3 flex items-center gap-2'>
        <MessageSquare className='h-5 w-5' />
        Comments
      </h3>
      <div className='space-y-4'>
        <div className='flex gap-3'>
          <Textarea
            placeholder='Add a comment...'
            value={newComment}
            onChange={(e) => onNewCommentChange(e.target.value)}
            rows={2}
            className='mb-2'
          />
          <Button onClick={onAddComment} size='sm'>
            Comment
          </Button>
        </div>
        {comments.length > 0 ? (
          comments
            .slice()
            .reverse()
            .map((comment) => (
              <div key={comment.id} className='text-sm'>
                <p className='text-muted-foreground whitespace-pre-wrap'>
                  {comment.content}
                </p>
                <div className='text-xs text-muted-foreground'>
                  {new Date(comment.createdAt).toLocaleString()}
                </div>
              </div>
            ))
        ) : (
          <p className='text-sm text-muted-foreground text-center py-4'>
            No comments yet.
          </p>
        )}
      </div>
    </div>
  );
}
