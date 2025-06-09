'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import ModalWrapper from '@/components/shared/ModalWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const projectColors = [
  '#4285F4',
  '#34A853',
  '#FBBC05',
  '#EA4335',
  '#A64FCF',
  '#FF6D01',
];

export default function AddProjectModal() {
  const { isAddProjectModalOpen, closeAddProjectModal, addProject } =
    useAppStore();
  const [projectName, setProjectName] = useState('');
  const [selectedColor, setSelectedColor] = useState(projectColors[0]);

  const handleSubmit = () => {
    if (projectName.trim()) {
      addProject({ name: projectName.trim(), color: selectedColor });
      setProjectName('');
      setSelectedColor(projectColors[0]);
      closeAddProjectModal();
    }
  };

  return (
    <ModalWrapper
      isOpen={isAddProjectModalOpen}
      onClose={closeAddProjectModal}
      title='Create New Project'
      description='Give your new project a name and choose a color.'
    >
      <div className='space-y-4 py-4'>
        <div className='space-y-2'>
          <Label htmlFor='projectName'>Project Name</Label>
          <Input
            id='projectName'
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder='e.g., Marketing Campaign'
          />
        </div>
        <div className='space-y-2'>
          <Label>Project Color</Label>
          <div className='flex gap-2'>
            {projectColors.map((color) => (
              <button
                key={color}
                type='button'
                className={`w-8 h-8 rounded-full border-2 ${selectedColor === color ? 'border-ring ring-2 ring-ring' : 'border-transparent'}`}
                style={{ backgroundColor: color }}
                onClick={() => setSelectedColor(color)}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className='flex justify-end gap-2'>
        <Button variant='outline' onClick={closeAddProjectModal}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!projectName.trim()}>
          Create Project
        </Button>
      </div>
    </ModalWrapper>
  );
}
