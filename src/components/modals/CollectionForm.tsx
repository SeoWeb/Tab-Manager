import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface CollectionFormProps {
  collectionName: string;
  collectionDescription: string;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  collectionId: string;
}

const CollectionForm: React.FC<CollectionFormProps> = ({
  collectionName,
  collectionDescription,
  onNameChange,
  onDescriptionChange,
  collectionId,
}) => {
  return (
    <div className='grid gap-4 py-4'>
      <div className='grid grid-cols-4 items-center gap-4'>
        <Label
          htmlFor={`edit-collectionName-${collectionId}`}
          className='text-right'
        >
          Name
        </Label>
        <Input
          id={`edit-collectionName-${collectionId}`}
          value={collectionName}
          onChange={(e) => onNameChange(e.target.value)}
          className='col-span-3'
          placeholder='Collection name'
        />
      </div>
      <div className='grid grid-cols-4 items-center gap-4'>
        <Label
          htmlFor={`edit-collectionDescription-${collectionId}`}
          className='text-right'
        >
          Description
        </Label>
        <Textarea
          id={`edit-collectionDescription-${collectionId}`}
          value={collectionDescription}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className='col-span-3'
          placeholder='A brief description of this collection.'
        />
      </div>
    </div>
  );
};

export default CollectionForm;
