import { AppState } from '../../types';
import type { AdvancedTask, TaskTemplate } from '@/types/tasks';
import { generateId, generateTimestamp } from './utils';

export const createTaskOrganizationActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  addTaskTag: (id: string, tag: string) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === id);
    if (!task || task.tags.includes(tag)) return;

    const actions = get();
    actions.updateTask(id, {
      tags: [...task.tags, tag],
    });
  },

  removeTaskTag: (id: string, tag: string) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    const actions = get();
    actions.updateTask(id, {
      tags: task.tags.filter((t) => t !== tag),
    });
  },

  setTaskCategory: (id: string, category: string) => {
    const actions = get();
    actions.updateTask(id, { category });
  },

  assignTaskToProject: (
    id: string,
    projectId: string,
    collectionId?: string
  ) => {
    const actions = get();
    actions.updateTask(id, { projectId, collectionId });
  },

  addTaskTemplate: (templateData: Omit<TaskTemplate, 'id' | 'createdAt'>) =>
    set((state: AppState) => ({
      ...state,
      taskTemplates: [
        ...state.taskTemplates,
        {
          ...templateData,
          id: generateId(),
          createdAt: generateTimestamp(),
        },
      ],
    })),

  updateTaskTemplate: (id: string, updates: Partial<TaskTemplate>) =>
    set((state: AppState) => ({
      ...state,
      taskTemplates: state.taskTemplates.map((template) =>
        template.id === id ? { ...template, ...updates } : template
      ),
    })),

  deleteTaskTemplate: (id: string) =>
    set((state: AppState) => ({
      ...state,
      taskTemplates: state.taskTemplates.filter(
        (template) => template.id !== id
      ),
    })),

  createTaskFromTemplate: (
    templateId: string,
    overrides?: Partial<AdvancedTask>
  ) => {
    const state = get();
    const template = state.taskTemplates.find((t) => t.id === templateId);
    if (!template) return;

    const taskFromTemplate: Omit<
      AdvancedTask,
      'id' | 'createdAt' | 'updatedAt' | 'activities'
    > = {
      title: template.name,
      description: template.description,
      priority: template.priority,
      status: 'todo',
      category: template.category,
      tags: [...template.tags],
      estimatedDuration: template.estimatedDuration,
      customFields: { ...template.customFields },
      subtasks: [],
      attachments: [],
      notes: '',
      reminders: [],
      progress: 0,
      comments: [],
      isArchived: false,
      isFavorite: false,
      ...overrides,
    };

    const actions = get();
    actions.addTask(taskFromTemplate);
  },
});
