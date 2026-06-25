# TabSpace: Chrome Web Store Listing & Permissions Guide

This document contains the official marketing description and the permission justifications required for submitting **TabSpace** to the Chrome Web Store.

---

## 1. Chrome Web Store Listing

### **Product Title**
TabSpace: Organize Tabs, Tasks & Notes by Project

### **Single-Sentence Summary (Subtitle)**
Transform your new tab page into a focused, project-based workspace. Organize tabs, bookmarks, tasks, and notes local-first or sync with your team.

---

### **Detailed Description (Marketing Copy)**

#### **🚀 Say Goodbye to Tab Clutter and Context-Switching Fatigue**
Are you tired of keeping 50 tabs open because you might need them later? Do you lose track of articles, design assets, and task lists because they are scattered across bookmarks, separate note apps, and todo tools?

Welcome to **TabSpace** — the all-in-one productivity dashboard that turns your New Tab page and browser popup into a structured, project-oriented workspace. 

TabSpace keeps your digital life organized by grouping your resources around what matters most: **Projects**. Whether you are planning a vacation, learning a new framework, or managing a development sprint with your team, TabSpace provides a clean space tailored for each endeavor.

---

### **✨ Core Features That Make TabSpace Unique**

*   📂 **Project-Driven Organization**
    Create dedicated projects (e.g., "Work Sprint," "Side Project," "Fitness Planning"). Switching projects instantly updates your entire view—showing only the tabs, tasks, calendar events, and notes related to that specific project.
*   📑 **Smart Tab & Bookmark Management**
    Save your currently open windows or tabs into named collections with one click. Clear your browser workspace knowing you can restore them anytime. TabSpace also mirrors your workspaces into Chrome bookmarks or imports existing bookmark folders seamlessly.
*   📋 **Integrated Task Board (Kanban & List Views)**
    Manage todos with due dates, priorities, categories, tags, progress tracking, and Pomodoro sessions. View your deadlines organized clearly in a built-in monthly **Calendar** scoped to your active project.
*   📝 **Rich Notes & Quick Todos**
    Keep project notes (complete with custom colors and pinning) and simple checklist todos right next to your resource links. No need to open external apps.
*   🔄 **Optional Cloud Sync & Real-Time Collaboration**
    TabSpace is **local-first** and fully functional offline. Want to sync across devices or work with others? Opt-in to connect a secure, self-hosted Cloudflare backend. Invite teammates to share projects, view real-time presence indicators, and collaborate seamlessly.
*   🔒 **Privacy-First & Secure**
    Your data belongs to you. By default, everything is stored locally in your browser storage. No trackers, no data brokers, and absolute privacy.

---

### **💡 Who is TabSpace For?**
*   **Developers & Designers:** Keep documentation, issues, design boards, and research tabs grouped by client project.
*   **Students & Researchers:** Separate research topics, reference links, lecture notes, and assignments into neat, switchable folders.
*   **Productivity Enthusiasts:** Use the integrated Kanban board, Pomodoro timers, and structured lists to get things done without switching apps.

Get organized, focus on one project at a time, and reclaim your browser today with **TabSpace**!

---

## 2. Chrome Developer Console: Permission Justifications

When submitting TabSpace to the Chrome Web Store, Google requires developers to justify the use of permissions listed in the extension's `manifest.json`. Below are the formal justifications to copy-paste into the Developer Console:

| Permission | Technical Need in Codebase | Formal Justification for Chrome Web Store Console |
| :--- | :--- | :--- |
| **`storage`** | Persists JSON state using Zustand middleware to `chrome.storage.local`. | **Required to securely persist and retrieve user data locally.** This includes project structures, task lists, customized notes, checkbox todos, and application preferences, allowing the extension to function entirely offline. |
| **`tabs`** | Reads active window tab objects to save them, and creates tabs to restore collections. | **Required to capture open tabs and windows when saving them into project collections.** It also enables restoring saved collections by opening those URLs in new tabs and windows. |
| **`bookmarks`** | Utilizes `chrome.bookmarks` API to read/write bookmark trees. | **Required to allow users to sync their TabSpace project structures with their Chrome Bookmarks.** It also permits importing existing bookmark folders into the extension as active projects. |
| **`activeTab`** | Captures detail of the current tab on action/shortcut. | **Required to allow the user to quickly save the current website they are viewing** directly into their active TabSpace project with a single click. |
| **`alarms`** | Schedules periodic sync intervals via `chrome.alarms`. | **Required to trigger background synchronization tasks.** This ensures that projects synced to the user's self-hosted Cloudflare backend remain up-to-date even when the extension popup or new tab page is closed. |
| **`host_permissions`**<br>`https://tab-manager-backend.ww0.dev/*` | Performs fetch calls to the specified self-hosted Cloudflare Worker sync API. | **Required to establish a secure network connection to the user's optional, self-hosted Cloudflare sync server.** This host permission is essential for synchronizing projects, task statuses, notes, and allowing real-time collaboration with invited team members. |

---

## 3. User-Facing Permission Explanations (FAQ)

If users ask why the extension requires these permissions, here is a clear, non-technical explanation:

*   **"Read and change your bookmarks"**
    *   *Why we need it:* So you can mirror your project links to your Chrome bookmarks bar and import folder links you've already saved.
*   **"Access your tabs" / "Read your browsing history"**
    *   *Why we need it:* TabSpace *does not* read your history. Chrome uses this warning because the extension can see which tabs you have open, which is necessary so you can save your current open tabs into a collection and restore them later.
*   **"Store data on your device"**
    *   *Why we need it:* To save all your projects, tasks, calendar notes, and settings locally on your machine.
*   **"Access to tab-manager-backend.ww0.dev" (or your custom sync server)**
    *   *Why we need it:* Only used if you choose to sync your projects across devices or collaborate with team members. It allows the extension to talk securely to your synchronization server.
