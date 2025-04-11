// ==UserScript==
// @name         Web.libretro.com FS Manager (Enhanced)
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Adds a file manager UI with context menus and copy/move for Module.FS on web.libretro.com
// @author       Your Name (or AI)
// @match        *://web.libretro.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const initialPath = '/'; // Starting directory
    const managerTitle = 'FS Manager';
    const toggleButtonText = '☰ FS'; // Text for the button to open/close the manager
    const menuIconChar = '⋮'; // Character for the context menu trigger

    // --- Styles ---
    GM_addStyle(`
        #fs-manager-container {
            position: fixed;
            top: 50px;
            right: 10px;
            width: 450px;
            max-height: 70vh;
            background-color: #f0f0f0;
            border: 1px solid #ccc;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 9999;
            font-family: sans-serif;
            font-size: 14px;
            color: #333;
            display: none; /* Hidden by default */
            flex-direction: column;
        }
        #fs-manager-header {
            background-color: #e0e0e0;
            padding: 8px;
            font-weight: bold;
            border-bottom: 1px solid #ccc;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #fs-manager-close-btn {
            cursor: pointer;
            padding: 2px 5px;
            border: 1px solid #aaa;
            background-color: #ddd;
            border-radius: 3px;
        }
        #fs-manager-path {
            padding: 5px 8px;
            background-color: #fff;
            border-bottom: 1px solid #ccc;
            word-break: break-all;
        }
         #fs-manager-controls {
            padding: 8px;
            border-bottom: 1px solid #ccc;
            display: flex;
            gap: 10px;
            align-items: center;
        }
        #fs-manager-controls button {
            padding: 4px 8px;
            cursor: pointer;
            border: 1px solid #aaa;
            background-color: #ddd;
            border-radius: 3px;
        }
        #fs-manager-list {
            list-style: none;
            padding: 0;
            margin: 0;
            overflow-y: auto;
            flex-grow: 1;
            position: relative; /* Needed for context menu positioning */
        }
        #fs-manager-list li {
            padding: 5px 8px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }
        #fs-manager-list li:hover {
            background-color: #e8f0fe;
        }
        #fs-manager-list li span.item-name {
           flex-grow: 1;
           margin-right: 10px;
           word-break: break-all;
           pointer-events: none; /* Prevent name click from interfering with li click */
        }
        #fs-manager-list li .item-menu-btn {
            padding: 0 8px;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            border: none;
            background: none;
            color: #555;
        }
         #fs-manager-list li .item-menu-btn:hover {
             color: #000;
         }
        #fs-manager-toggle-btn {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 9998;
            padding: 5px 10px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
        }
        .fs-manager-dir {
            font-weight: bold;
            color: #0056b3; /* Blue for directories */
        }
        .fs-manager-file {
            color: #333; /* Default color for files */
        }

        /* Context Menu Styles */
        .fs-context-menu {
            position: absolute;
            background-color: #fff;
            border: 1px solid #ccc;
            box-shadow: 0 1px 5px rgba(0,0,0,0.15);
            z-index: 10000; /* Above manager */
            padding: 5px 0;
            min-width: 120px;
            list-style: none;
            margin: 0;
        }
        .fs-context-menu li {
            padding: 6px 12px;
            cursor: pointer;
            font-size: 13px;
            border-bottom: none; /* Override list item border */
             display: block; /* Override flex */
        }
         .fs-context-menu li:hover {
             background-color: #e8f0fe;
         }
    `);

    // --- State ---
    let currentPath = initialPath;
    let fsModule = null; // To store the Module.FS object
    let activeContextMenu = null; // Reference to the currently open context menu

    // --- UI Elements ---
    const container = document.createElement('div');
    container.id = 'fs-manager-container';

    const header = document.createElement('div');
    header.id = 'fs-manager-header';
    header.innerHTML = `<span>${managerTitle}</span><button id="fs-manager-close-btn">X</button>`;
    container.appendChild(header);

    const pathDisplay = document.createElement('div');
    pathDisplay.id = 'fs-manager-path';
    container.appendChild(pathDisplay);

    const controls = document.createElement('div');
    controls.id = 'fs-manager-controls';
    controls.innerHTML = `
        <button id="fs-manager-up-btn" title="Go to parent directory">Up</button>
        <button id="fs-manager-mkdir-btn">Create Folder...</button>
        <button id="fs-manager-refresh-btn" title="Refresh list">Refresh</button> `;
    container.appendChild(controls);


    const list = document.createElement('ul');
    list.id = 'fs-manager-list';
    container.appendChild(list);

    document.body.appendChild(container);

    const toggleButton = document.createElement('button');
    toggleButton.id = 'fs-manager-toggle-btn';
    toggleButton.textContent = toggleButtonText;
    document.body.appendChild(toggleButton);

    // --- Helper Functions ---

    // Basic path joining helper
    function pathJoin(dir, item) {
        if (!item) return dir; // Handle case where item might be empty
        if (dir === '/') return `/${item.replace(/^\/+/, '')}`; // Avoid double slashes at root
        return `${dir.replace(/\/+$/, '')}/${item.replace(/^\/+/, '')}`; // Avoid double slashes elsewhere
    }

    // Get base name from path
    function baseName(path) {
        return path.split('/').pop();
    }

    // Show alert message (can be customized later)
    function showMessage(message, type = 'info') {
        console[type === 'error' ? 'error' : 'log']('FS Manager:', message);
        alert(message);
    }

    // Close any active context menu
    function closeContextMenu() {
        if (activeContextMenu) {
            activeContextMenu.remove();
            activeContextMenu = null;
            document.removeEventListener('click', handleOutsideClick, true); // Remove the global listener
        }
    }

    // Handler for clicks outside the context menu
    function handleOutsideClick(event) {
        if (activeContextMenu && !activeContextMenu.contains(event.target)) {
            closeContextMenu();
        }
    }


    // Create and show the context menu for an item
    function createContextMenu(itemPath, isDir, event) {
        event.stopPropagation(); // Prevent triggering li click (navigation)
        closeContextMenu(); // Close any existing menu

        const menu = document.createElement('ul');
        menu.className = 'fs-context-menu';

        const actions = [
            { label: 'Rename / Move...', action: () => handleRename(itemPath, isDir) },
            { label: 'Copy to...', action: () => handleCopy(itemPath, isDir) },
            { label: 'Delete', action: () => handleDelete(itemPath, isDir) },
        ];

        actions.forEach(item => {
            const menuItem = document.createElement('li');
            menuItem.textContent = item.label;
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                closeContextMenu();
                item.action();
            });
            menu.appendChild(menuItem);
        });

        // Positioning: Relative to the list container, near the click event
        const listRect = list.getBoundingClientRect();
        const managerRect = container.getBoundingClientRect();

        // Calculate position relative to the viewport first
        let top = event.clientY;
        let left = event.clientX;

         // Adjust position to be relative to the manager container's top-left
         // This makes absolute positioning work within the scrolling list area
         // Note: This might need fine-tuning based on exact layout/scrolling
         menu.style.top = `${event.clientY - managerRect.top + list.scrollTop}px`;
         menu.style.left = `${event.clientX - managerRect.left - 50}px`; // Offset slightly left

        // Append to list container so it scrolls with the list
        list.appendChild(menu);
        activeContextMenu = menu;

        // Add listener to close menu when clicking outside
        // Use capture phase (true) to catch clicks before they might be stopped elsewhere
        document.addEventListener('click', handleOutsideClick, true);
    }


    // Recursive copy function
    function copyRecursive(sourcePath, destPath) {
        if (!fsModule) throw new Error("Module.FS not available.");

        const stats = fsModule.stat(sourcePath);
        const isDir = fsModule.isDir(stats.mode);

        if (isDir) {
            try {
                fsModule.mkdir(destPath); // Create destination directory
            } catch (e) {
                // Ignore error if directory already exists, throw others
                if (e.code !== 'EEXIST') throw e;
            }

            const items = fsModule.readdir(sourcePath);
            items.forEach(item => {
                if (item === '.' || item === '..') return;
                copyRecursive(pathJoin(sourcePath, item), pathJoin(destPath, item)); // Recursive call
            });
        } else {
            // It's a file, perform simple copy
            const data = fsModule.readFile(sourcePath, { encoding: 'binary' });
            fsModule.writeFile(destPath, data, { encoding: 'binary' });
             // console.log(`Copied file ${sourcePath} to ${destPath}`);
        }
    }


    // --- Action Handlers ---

    function handleRename(oldPath, isDir) {
         if (!fsModule) return;
         const oldName = baseName(oldPath);
         const itemType = isDir ? 'folder' : 'file';
         const newName = prompt(`Enter new name or path for the ${itemType} "${oldName}":\n(Example: new_name or /some/other/path/new_name)`, oldName);

         if (newName === null || newName.trim() === '' || newName === oldName) {
             return; // User cancelled or entered invalid name
         }

         let newPath;
         if (newName.includes('/')) {
             // If it contains '/', treat it as a full path (absolute or relative needs careful thought, assume absolute if starts with /)
             newPath = newName.startsWith('/') ? newName : pathJoin(fsModule.cwd(), newName); // Note: Using FS CWD might be needed for relative paths
             // Simple approach: assume relative to current *manager* path if not starting with /
             newPath = newName.startsWith('/') ? newName : pathJoin(currentPath, newName);

         } else {
             // Just a name change in the current directory
             const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
             newPath = pathJoin(parentDir, newName);
         }

         if (oldPath === newPath) return; // No change

         try {
             console.log(`FS Manager: Renaming/Moving "${oldPath}" to "${newPath}"`);
             fsModule.rename(oldPath, newPath);
             renderDirectory(currentPath); // Refresh view
             showMessage(`Successfully renamed/moved "${oldName}" to "${baseName(newPath)}"`);
         } catch (error) {
             console.error(`FS Manager: Error renaming/moving ${oldPath} to ${newPath}:`, error);
             showMessage(`Error renaming/moving:\n${error.message}`, 'error');
         }
    }

     function handleDelete(itemPath, isDir) {
         if (!fsModule) return;

         const itemType = isDir ? 'folder' : 'file';
         const itemName = baseName(itemPath);

         // Extra caution for directories
         let confirmMessage = `Are you sure you want to delete the ${itemType} "${itemName}"?`;
         if (isDir) {
             confirmMessage += "\n\nWarning: This action currently only works for EMPTY folders.";
         }

         if (!confirm(confirmMessage)) {
             return;
         }

         try {
             if (isDir) {
                 // FS.rmdir only works on empty directories
                 console.log(`FS Manager: Deleting directory "${itemPath}"`);
                 fsModule.rmdir(itemPath);
             } else {
                 console.log(`FS Manager: Deleting file "${itemPath}"`);
                 fsModule.unlink(itemPath);
             }
             renderDirectory(currentPath); // Refresh view
             showMessage(`Successfully deleted ${itemType} "${itemName}"`);
         } catch (error) {
              console.error(`FS Manager: Error deleting ${itemPath}:`, error);
              let message = error.message;
              if (isDir && error.code === 'ENOTEMPTY') {
                   message = "Folder is not empty. Cannot delete non-empty folders with this simple manager.";
              }
              showMessage(`Error deleting ${itemType}:\n${message}`, 'error');
         }
    }

    function handleCopy(sourcePath, isDir) {
        if (!fsModule) return;
        const itemName = baseName(sourcePath);
        const itemType = isDir ? 'folder' : 'file';

        const suggestedDestName = itemName + (isDir ? '_copy' : '.copy');
        const destinationPath = prompt(`Enter destination path/name to copy the ${itemType} "${itemName}" to:\n(Example: /target/folder or new_name_in_current_dir)`, pathJoin(currentPath, suggestedDestName));

        if (!destinationPath || destinationPath.trim() === '' || destinationPath === sourcePath) {
            showMessage("Copy cancelled or invalid destination.", 'info');
            return;
        }

        // Check if destination exists (basic check)
         try {
            fsModule.stat(destinationPath);
            if (!confirm(`Destination "${baseName(destinationPath)}" already exists. Overwrite?`)) {
                showMessage("Copy cancelled.", 'info');
                return;
            }
             // If confirmed, try to delete existing item first (carefully!)
             try {
                 const destStat = fsModule.stat(destinationPath);
                 if (fsModule.isDir(destStat.mode)) {
                      showMessage("Cannot overwrite a folder with a file/folder copy in this simple version. Please delete manually first.", 'error');
                      return; // Avoid complex recursive delete for overwrite
                 } else {
                     fsModule.unlink(destinationPath); // Delete existing file
                 }
             } catch (deleteError) {
                 // Ignore if delete failed (maybe didn't exist after all), proceed with copy attempt
             }

        } catch (e) {
            // Doesn't exist or other stat error - OK to proceed
             if (e.code !== 'ENOENT') {
                  console.warn("FS Manager: Stat check failed unexpectedly:", e);
             }
        }


        try {
            console.log(`FS Manager: Copying "${sourcePath}" to "${destinationPath}"`);
            showSpinner(true); // Show hypothetical spinner

            // Use setTimeout to allow UI to update before potentially long copy
            setTimeout(() => {
                 try {
                     copyRecursive(sourcePath, destinationPath);
                     renderDirectory(currentPath); // Refresh view after copy completes
                     showMessage(`Successfully copied "${itemName}" to "${baseName(destinationPath)}"`);
                 } catch (copyError) {
                    console.error(`FS Manager: Error during copy from ${sourcePath} to ${destinationPath}:`, copyError);
                    showMessage(`Error copying ${itemType}:\n${copyError.message}`, 'error');
                 } finally {
                      showSpinner(false); // Hide spinner
                 }
            }, 10); // Small delay

        } catch (error) { // Catch errors from initial checks or the setTimeout setup itself
            console.error(`FS Manager: Error initiating copy from ${sourcePath} to ${destinationPath}:`, error);
            showMessage(`Error starting copy:\n${error.message}`, 'error');
            showSpinner(false);
        }
    }


    function handleMkdir() {
         if (!fsModule) return;
         const newDirName = prompt("Enter the name for the new folder:");

         if (!newDirName || newDirName.trim() === '') {
             showMessage("Folder creation cancelled or name empty.", 'info');
             return;
         }
         const sanitizedName = newDirName.trim();

         if (sanitizedName.includes('/')) {
              showMessage("Folder name cannot contain '/'.", 'error');
              return;
         }

         const newDirPath = pathJoin(currentPath, sanitizedName);

         try {
             console.log(`FS Manager: Creating directory "${newDirPath}"`);
             fsModule.mkdir(newDirPath);
             renderDirectory(currentPath); // Refresh view
             showMessage(`Successfully created folder "${sanitizedName}"`);
         } catch (error) {
            // Check if it already exists
             if (error.code === 'EEXIST') {
                 showMessage(`Folder "${sanitizedName}" already exists.`, 'error');
             } else {
                console.error(`FS Manager: Error creating directory ${newDirPath}:`, error);
                showMessage(`Error creating folder:\n${error.message}`, 'error');
             }
         }
    }

    // Navigate up one level
    function handleUp() {
        if (currentPath === '/') return;
        // Find the last '/'
        const lastSlashIndex = currentPath.lastIndexOf('/');
        if (lastSlashIndex === 0) {
             // Parent is root
             renderDirectory('/');
        } else if (lastSlashIndex > 0) {
            // Parent is some other directory
            const parentPath = currentPath.substring(0, lastSlashIndex);
            renderDirectory(parentPath);
        }
         // If lastSlashIndex is -1 (shouldn't happen with absolute paths), do nothing
    }

    // Placeholder for a loading indicator
    function showSpinner(show) {
        // TODO: Implement a real visual indicator if needed
        console.log(`Spinner: ${show ? 'ON' : 'OFF'}`);
        container.style.opacity = show ? '0.8' : '1'; // Simple visual feedback
        container.style.pointerEvents = show ? 'none' : 'auto';
    }

    // --- Render Function ---
    function renderDirectory(path) {
        if (!fsModule) {
            console.error("FS Manager: Module.FS not available yet.");
            list.innerHTML = '<li>Error: Module.FS not found. Retrying...</li>';
            pathDisplay.textContent = `Path: ${path} (Error: FS not ready)`;
            checkFSAvailability(); // Attempt to re-check
            return;
        }

        closeContextMenu(); // Close menu when navigating
        currentPath = path;
        pathDisplay.textContent = `Path: ${currentPath}`;
        list.innerHTML = ''; // Clear previous list
        list.scrollTop = 0; // Reset scroll position

        // Disable "Up" button if at root
        document.getElementById('fs-manager-up-btn').disabled = (currentPath === '/');

        try {
            const items = fsModule.readdir(currentPath);
            const sortedItems = [];
            const files = [];

            items.forEach(item => {
                if (item === '.' || item === '..') return; // Skip . and ..
                const itemPath = pathJoin(currentPath, item);
                 try {
                     const stats = fsModule.stat(itemPath);
                     const isDir = fsModule.isDir(stats.mode);
                     (isDir ? sortedItems : files).push({ name: item, path: itemPath, isDir: isDir }); // Group folders first
                 } catch (statError) {
                     console.warn(`FS Manager: Could not stat ${itemPath}:`, statError);
                     // List it as a file with an error indicator? Or skip? Let's list as file.
                     files.push({ name: item, path: itemPath, isDir: false, error: true });
                 }
            });

            // Sort folders and files alphabetically within their groups
            sortedItems.sort((a, b) => a.name.localeCompare(b.name));
            files.sort((a, b) => a.name.localeCompare(b.name));

            // Combine folders and files
            const allItems = sortedItems.concat(files);


            allItems.forEach(({ name, path: itemPath, isDir, error }) => {
                const listItem = document.createElement('li');
                listItem.dataset.name = name;
                listItem.dataset.path = itemPath;
                listItem.dataset.isdir = isDir;

                const itemNameSpan = document.createElement('span');
                itemNameSpan.className = 'item-name';
                itemNameSpan.textContent = name + (isDir ? '/' : '') + (error ? ' ( inaccessible )' : '');
                 itemNameSpan.classList.add(isDir ? 'fs-manager-dir' : 'fs-manager-file');

                 if (isDir) {
                     // Click on list item (but not menu button) to navigate
                     listItem.addEventListener('click', (e) => {
                         if (!e.target.classList.contains('item-menu-btn')) {
                              renderDirectory(itemPath);
                         }
                     });
                 } else {
                      // Optional: Add click handler for files (e.g., view content)
                 }
                 listItem.appendChild(itemNameSpan);


                // Menu Button
                const menuBtn = document.createElement('button');
                menuBtn.className = 'item-menu-btn';
                menuBtn.textContent = menuIconChar;
                menuBtn.title = 'Actions...';
                menuBtn.addEventListener('click', (event) => createContextMenu(itemPath, isDir, event));
                listItem.appendChild(menuBtn);

                list.appendChild(listItem);
            });

        } catch (error) {
            console.error(`FS Manager: Error reading directory ${currentPath}:`, error);
            list.innerHTML = `<li>Error listing directory: ${error.message}</li>`;
            showMessage(`Error listing directory "${currentPath}":\n${error.message}`, 'error');
        }
    }

    // --- Event Listeners ---
    toggleButton.addEventListener('click', () => {
        const isHidden = container.style.display === 'none';
        container.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && fsModule) {
            renderDirectory(currentPath); // Refresh view when opened
        } else if (isHidden && !fsModule) {
            checkFSAvailability(); // Try to init if opened and not ready
        } else if (!isHidden) {
            closeContextMenu(); // Close menu when manager is hidden
        }
    });

    document.getElementById('fs-manager-close-btn').addEventListener('click', () => {
        container.style.display = 'none';
        closeContextMenu();
    });

    document.getElementById('fs-manager-up-btn').addEventListener('click', handleUp);
    document.getElementById('fs-manager-mkdir-btn').addEventListener('click', handleMkdir);
     document.getElementById('fs-manager-refresh-btn').addEventListener('click', () => renderDirectory(currentPath));


    // --- Initialization ---
    function checkFSAvailability() {
        if (typeof Module !== 'undefined' && Module.FS && Module.callMain) { // Added check for callMain as FS might init late
            console.log("FS Manager: Module.FS found!");
            fsModule = Module.FS;
            if (container.style.display === 'flex') {
                 renderDirectory(currentPath);
            } else {
                pathDisplay.textContent = `Path: ${currentPath} (Ready)`;
            }
            // Clear the check interval if it was set
            if (window.fsManagerCheckInterval) {
                clearInterval(window.fsManagerCheckInterval);
                window.fsManagerCheckInterval = null;
            }
        } else {
            console.log("FS Manager: Waiting for Module.FS...");
            pathDisplay.textContent = `Path: ${currentPath} (Waiting for FS...)`;
            // Use an interval for repeated checks if needed
            if (!window.fsManagerCheckInterval) {
                 window.fsManagerCheckInterval = setInterval(checkFSAvailability, 1500); // Check periodically
            }
        }
    }

    // Initial check after document idle
    setTimeout(checkFSAvailability, 500); // Delay initial check slightly

})();