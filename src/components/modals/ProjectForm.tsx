import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ProjectFormProps {
  projectName: string;
  projectColor: string;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  projectId: string;
}

const ProjectForm: React.FC<ProjectFormProps> = ({
  projectName,
  projectColor,
  onNameChange,
  onColorChange,
  projectId,
}) => {
  return (
    <div className='grid gap-4 py-4'>
      {/* Project Name Input */}
      <div className='grid grid-cols-4 items-center gap-4'>
        <Label htmlFor={`edit-projectName-${projectId}`} className='text-right'>
          Name
        </Label>
        <Input
          id={`edit-projectName-${projectId}`}
          value={projectName}
          onChange={(e) => onNameChange(e.target.value)}
          className='col-span-3'
          placeholder='Project name'
        />
      </div>
      {/* Project Color Input */}
      <div className='grid grid-cols-4 items-center gap-4'>
        <Label
          htmlFor={`edit-projectColor-${projectId}`}
          className='text-right'
        >
          Color
        </Label>
        <Input
          id={`edit-projectColor-${projectId}`}
          type='color'
          value={projectColor}
          onChange={(e) => onColorChange(e.target.value)}
          className='col-span-3 h-8'
        />
      </div>
    </div>
  );
};

export default ProjectForm;
