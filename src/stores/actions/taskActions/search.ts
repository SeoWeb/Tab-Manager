import { AppState } from '../../types';

export const createTaskSearchActions = (
  set: (fn: (state: AppState) => AppState) => void,
  get: () => AppState
) => ({
  searchTasks: (query: string) => {
    const state = get();
    const lowercaseQuery = query.toLowerCase();

    return state.tasks.filter(
      (task) =>
        !task.isArchived &&
        (task.title.toLowerCase().includes(lowercaseQuery) ||
          task.description?.toLowerCase().includes(lowercaseQuery) ||
          task.category.toLowerCase().includes(lowercaseQuery) ||
          task.tags.some((tag) => tag.toLowerCase().includes(lowercaseQuery)) ||
          task.notes.toLowerCase().includes(lowercaseQuery))
    );
  },

  getRecentTasks: (limit: number = 10) => {
    const state = get();
    return state.tasks
      .filter((task) => !task.isArchived)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  },

  getFavoriteTasks: () => {
    const state = get();
    return state.tasks.filter((task) => task.isFavorite && !task.isArchived);
  },

  toggleTaskFavorite: (id: string) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;

    const actions = get();
    actions.updateTask(id, { isFavorite: !task.isFavorite });
  },
});
