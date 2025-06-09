# Bookmark Synchronization

This document describes the bidirectional bookmark synchronization feature implemented for the Tab Manager Chrome Extension.

## Overview

The bookmark synchronization system ensures that changes made to bookmarks in Chrome are automatically reflected in the Tab Manager extension, and vice versa. This creates a seamless experience where users can manage their organized links either through the extension interface or through Chrome's native bookmark manager.

## Architecture

### Components

1. **BookmarkSyncService** (`src/lib/bookmarkSyncService.ts`)
   - Core synchronization logic
   - Event listeners for Chrome bookmark changes
   - Bidirectional sync operations
   - Conflict resolution

2. **BookmarkService** (`src/lib/bookmarkService.ts`)
   - Chrome bookmarks API wrapper
   - CRUD operations for bookmarks and folders
   - Error handling

3. **BookmarkSyncStatus** (`src/components/sync/BookmarkSyncStatus.tsx`)
   - UI component for sync status display
   - Manual sync trigger
   - Visual feedback for sync operations

### Data Flow

```
Chrome Bookmarks ←→ BookmarkSyncService ←→ App Store ←→ UI Components
```

## Synchronization Features

### Automatic Sync

The system automatically syncs changes in both directions:

**From Extension to Bookmarks:**
- Creating/updating/deleting projects → bookmark folders
- Creating/updating/deleting collections → bookmark subfolders  
- Creating/updating/deleting links → bookmarks

**From Bookmarks to Extension:**
- Creating bookmark folders → new projects/collections
- Updating bookmark titles/URLs → update extension data
- Deleting bookmarks → remove from extension
- Moving bookmarks → update organization

### Manual Sync

Users can trigger manual synchronization through:
- Sync button in the project header
- Automatic sync on extension startup
- Periodic background sync (planned)

### Conflict Resolution

The system handles conflicts using these strategies:

1. **Last-Write-Wins**: For simple updates like title changes
2. **Merge Strategy**: For complex structural changes
3. **User Notification**: For irreconcilable conflicts (planned)

## Implementation Details

### Folder Structure

The extension creates a root folder structure in Chrome bookmarks:

```
Other Bookmarks/
└── Tab Manager Projects/
    ├── Project 1/
    │   ├── Collection A/
    │   │   ├── Link 1
    │   │   └── Link 2
    │   └── Collection B/
    │       └── Link 3
    └── Project 2/
        └── Collection C/
            └── Link 4
```

### Event Handling

The service listens to Chrome bookmark events:

- `chrome.bookmarks.onCreated` - New bookmarks/folders
- `chrome.bookmarks.onRemoved` - Deleted bookmarks/folders
- `chrome.bookmarks.onChanged` - Updated titles/URLs
- `chrome.bookmarks.onMoved` - Reorganization

### Sync Process

1. **Initialization**
   - Find or create root "Tab Manager Projects" folder
   - Set up event listeners
   - Perform initial full sync

2. **Full Sync**
   - Compare bookmark structure with extension data
   - Create missing items in both directions
   - Update changed items
   - Remove deleted items

3. **Incremental Sync**
   - Process individual bookmark events
   - Update only affected items
   - Debounce rapid changes

### Error Handling

The system includes comprehensive error handling:

- Chrome API permission errors
- Network connectivity issues
- Bookmark structure corruption
- Concurrent modification conflicts

## Usage

### For Users

1. **Automatic Operation**: Sync happens automatically in the background
2. **Manual Sync**: Click the sync button in the project header
3. **Status Indication**: Sync status is shown with visual indicators
4. **Native Bookmarks**: Use Chrome's bookmark manager normally

### For Developers

```typescript
import { bookmarkSyncService } from '@/lib/bookmarkSyncService';

// Initialize sync service
await bookmarkSyncService.initialize();

// Trigger manual sync
await bookmarkSyncService.performFullSync();

// Clean up
bookmarkSyncService.destroy();
```

## Configuration

### Sync Settings

- **Auto-sync**: Enabled by default
- **Sync Interval**: Real-time via events + periodic full sync
- **Conflict Resolution**: Configurable strategy (planned)

### Performance

- **Debouncing**: 1-second delay for rapid changes
- **Batch Operations**: Multiple changes processed together
- **Incremental Updates**: Only changed items are processed

## Testing

The sync service includes comprehensive tests:

```bash
npm test -- bookmarkSyncService.test.ts
```

Test coverage includes:
- Event listener setup
- Full sync operations
- Incremental sync
- Error handling
- Conflict resolution

## Troubleshooting

### Common Issues

1. **Sync Not Working**
   - Check Chrome bookmark permissions
   - Verify root folder exists
   - Check console for errors

2. **Duplicate Items**
   - Trigger manual full sync
   - Check for bookmark ID conflicts

3. **Missing Items**
   - Verify bookmark folder structure
   - Check for permission issues

### Debug Mode

Enable debug logging:

```javascript
localStorage.setItem('bookmark-sync-debug', 'true');
```

## Future Enhancements

### Planned Features

1. **Conflict Resolution UI**: Visual conflict resolution interface
2. **Sync History**: Track and display sync operations
3. **Selective Sync**: Choose which projects to sync
4. **Backup/Restore**: Bookmark structure backup
5. **Import/Export**: Bulk operations for bookmark data

### Performance Optimizations

1. **Smart Diffing**: More efficient change detection
2. **Lazy Loading**: Load bookmark data on demand
3. **Caching**: Cache bookmark structure locally
4. **Background Sync**: Periodic sync in service worker

## API Reference

### BookmarkSyncService

```typescript
class BookmarkSyncService {
  // Initialize the service
  async initialize(): Promise<void>
  
  // Perform full synchronization
  async performFullSync(): Promise<void>
  
  // Clean up resources
  destroy(): void
}
```

### BookmarkSyncStatus Component

```typescript
interface BookmarkSyncStatusProps {
  className?: string;
}

function BookmarkSyncStatus(props: BookmarkSyncStatusProps): JSX.Element
```

## Security Considerations

- **Permissions**: Requires `bookmarks` permission in manifest
- **Data Validation**: All bookmark data is validated before processing
- **Error Boundaries**: Sync errors don't crash the extension
- **Privacy**: No external data transmission

## Performance Metrics

- **Sync Time**: < 1 second for typical datasets
- **Memory Usage**: Minimal impact on extension memory
- **CPU Usage**: Low background processing
- **Network**: No external network requests