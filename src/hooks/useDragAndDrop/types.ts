export interface DragItem {
  id: string;
  type: 'link' | 'collection' | 'tab' | 'bookmark' | 'project' | 'quickClip';
  data: {
    projectId: string;
    collectionId?: string;
    clipId?: string;
    link?: {
      id: string;
      title: string;
      url: string;
      favIconUrl?: string;
    };
    collection?: {
      id: string;
      name: string;
      links: Array<{
        id: string;
        title: string;
        url: string;
        favIconUrl?: string;
      }>;
    };
    project?: {
      id: string;
      name: string;
      color?: string;
      icon?: string;
    };
    tab?: {
      id: number;
      title: string;
      url: string;
      favIconUrl?: string;
      windowId: number;
    };
    bookmark?: {
      id: string;
      title: string;
      url: string;
      favIconUrl?: string;
    };
    quickClip?: {
      id: string;
      title: string;
      url: string;
      favIconUrl?: string;
    };
    [key: string]: unknown;
  };
}

export interface CollectionDropPlaceholder {
  projectId: string;
  position: number;
  targetCollectionId: string;
}

export interface LinkDropPlaceholder {
  projectId: string;
  collectionId: string;
  position: number;
  targetLinkId: string;
}
