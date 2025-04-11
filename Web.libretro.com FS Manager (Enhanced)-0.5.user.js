// ==UserScript==
// @name         Web.libretro.com FS Manager
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  优化后的文件管理器：复制和移动操作需要两步，第一次点击“复制”或“移动”后进入待执行状态，此时待执行按钮会常驻，即使切换目录，仍可点击“复制到此处”或“移动到此处”执行操作；重命名操作依然按原逻辑。支持导入和导出。
// @author       Your Name
// @match        *://web.libretro.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    const initialPath = '/home/web_user/retroarch/userdata/content';
    const managerTitle = 'FS Manager';
    const toggleButtonText = '☰ FS';

    // --- 状态变量 ---
    let currentPath = initialPath;
    let fsModule = null; // Module.FS 对象
    let selectedItems = []; // 当前选中的待操作的文件或目录（多选）
    // pending 状态：pendingOp 为 "copy" 或 "move" 或 null
    let pendingOp = null;
    // pendingItems 保存第一次点击时选中的项（后续不随当前选中变化）
    let pendingItems = [];

    // --- CSS 样式 ---
    GM_addStyle(`
        #fs-manager-container {
            position: fixed;
            top: 50px;
            right: 10px;
            width: 650px;
            max-height: 70vh;
            background-color: #f0f0f0;
            border: 1px solid #ccc;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 9999;
            font-family: sans-serif;
            font-size: 14px;
            color: #333;
            display: none;
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
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
        }
        #fs-manager-controls button {
            padding: 4px 8px;
            cursor: pointer;
            border: 1px solid #aaa;
            background-color: #ddd;
            border-radius: 3px;
        }
        /* 待执行操作按钮 */
        #fs-manager-pending-op-btn {
            padding: 4px 8px;
            cursor: pointer;
            border: 1px solid #f00;
            background-color: #fee;
            border-radius: 3px;
        }
        #fs-manager-list {
            list-style: none;
            padding: 0;
            margin: 0;
            overflow-y: auto;
            flex-grow: 1;
        }
        #fs-manager-list li {
            padding: 5px 8px;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        #fs-manager-list li:hover {
            background-color: #e8f0fe;
        }
        #fs-manager-list li span.item-name {
            flex-grow: 1;
            word-break: break-all;
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
            color: #0056b3;
        }
        .fs-manager-file {
            color: #333;
        }
        /* 复选框样式 */
        #fs-manager-list li input[type="checkbox"] {
            margin-right: 5px;
        }
    `);

    // --- UI 元素创建 ---
    const container = document.createElement('div');
    container.id = 'fs-manager-container';

    const header = document.createElement('div');
    header.id = 'fs-manager-header';
    header.innerHTML = `<span>${managerTitle}</span><button id="fs-manager-close-btn">X</button>`;
    container.appendChild(header);

    const pathDisplay = document.createElement('div');
    pathDisplay.id = 'fs-manager-path';
    container.appendChild(pathDisplay);

    // 控制面板（包含目录上移、创建、刷新、复制、移动、重命名、删除、导入、导出）
    const controls = document.createElement('div');
    controls.id = 'fs-manager-controls';
    controls.innerHTML = `
        <button id="fs-manager-up-btn" title="返回上一级目录">上一级</button>
        <button id="fs-manager-mkdir-btn">创建文件夹...</button>
        <button id="fs-manager-refresh-btn" title="刷新列表">刷新</button>
        <button id="fs-manager-move-btn" title="标记移动选中项">移动</button>
        <button id="fs-manager-copy-btn" title="标记复制选中项">复制</button>
        <button id="fs-manager-rename-btn" title="重命名单个选中项">重命名</button>
        <button id="fs-manager-delete-btn" title="删除选中项">删除</button>
        <button id="fs-manager-import-btn" title="导入本地文件">导入</button>
        <button id="fs-manager-export-btn" title="导出选中项">导出</button>
    `;
    container.appendChild(controls);

    // 待执行操作按钮（常驻，当 pendingOp 不为空时显示）
    const pendingOpBtn = document.createElement('button');
    pendingOpBtn.id = 'fs-manager-pending-op-btn';
    pendingOpBtn.style.display = 'none';
    controls.appendChild(pendingOpBtn);

    const list = document.createElement('ul');
    list.id = 'fs-manager-list';
    container.appendChild(list);

    document.body.appendChild(container);

    const toggleButton = document.createElement('button');
    toggleButton.id = 'fs-manager-toggle-btn';
    toggleButton.textContent = toggleButtonText;
    document.body.appendChild(toggleButton);

    // --- 辅助函数 ---
    function pathJoin(dir, item) {
        if (!item) return dir;
        const dirClean = dir.replace(/\/+$/, '');
        const itemClean = item.replace(/^\/+/, '');
        if (dirClean === '' || dirClean === '/') return `/${itemClean}`;
        return `${dirClean}/${itemClean}`;
    }
    function baseName(path) {
        return path.split('/').pop() || '';
    }
    function showMessage(message, type = 'info') {
        console[type === 'error' ? 'error' : 'log']('FS Manager:', message);
        alert(message);
    }
    // 重置当前选中项（不清除 pending 状态）
    function resetSelection() {
        selectedItems = [];
        document.querySelectorAll('#fs-manager-list input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = false;
        });
    }
    // 更新选中项（点击复选框时调用）
    function updateSelection(itemPath, checked) {
        if (checked) {
            if (!selectedItems.includes(itemPath)) {
                selectedItems.push(itemPath);
            }
        } else {
            selectedItems = selectedItems.filter(p => p !== itemPath);
        }
        console.log("当前选中项：", selectedItems);
    }
    // 若输入为相对路径，则以当前目录合成绝对路径
    function resolvePath(inputPath) {
        if (!fsModule) return inputPath;
        return inputPath.startsWith('/') ? inputPath : pathJoin(currentPath, inputPath);
    }

    // --- 文件操作函数 ---
    // 封装复制单个文件函数
    function copyFile(sourcePath, destPath) {
        const data = fsModule.readFile(sourcePath);
        fsModule.writeFile(destPath, data);
    }
    // 递归复制目录或文件
    function copyRecursive(sourcePath, destPath) {
        const stats = fsModule.stat(sourcePath);
        const isDir = fsModule.isDir(stats.mode);
        if (isDir) {
            try {
                fsModule.mkdir(destPath);
            } catch (e) {
                if (e.code !== 'EEXIST') throw e;
            }
            const items = fsModule.readdir(sourcePath);
            items.forEach(item => {
                if (item === '.' || item === '..') return;
                copyRecursive(pathJoin(sourcePath, item), pathJoin(destPath, item));
            });
        } else {
            copyFile(sourcePath, destPath);
        }
    }

    // --- 复制操作（两步） ---
    // 第一步：点击“复制”按钮，保存当前选中项为 pendingItems 并设定 pendingOp 状态
    function markCopy() {
        if (selectedItems.length === 0) {
            showMessage("请先选择需要复制的文件或目录。");
            return;
        }
        pendingOp = "copy";
        pendingItems = selectedItems.slice();
        pendingOpBtn.textContent = "复制到此处";
        pendingOpBtn.style.display = "inline-block";
        // showMessage("已标记复制操作，请进入目标目录后点击“复制到此处”按钮。");
        resetSelection();
    }
    // 第二步：在目标目录点击待执行按钮，执行复制操作
    function executeCopy() {
        if (pendingOp !== "copy" || pendingItems.length === 0) {
            showMessage("无待执行的复制操作。", "error");
            return;
        }
        pendingItems.forEach(sourcePath => {
            const name = baseName(sourcePath);
            const destPath = pathJoin(currentPath, name);
            if (sourcePath === destPath) {
                console.warn(`跳过复制：源与目标相同 (${sourcePath})`);
                return;
            }
            try {
                try {
                    fsModule.stat(destPath);
                    if (!confirm(`目标 "${name}" 已存在，是否覆盖？`)) return;
                } catch(e) {
                    // if (e.code !== 'ENOENT') throw e;
                }
                const stats = fsModule.stat(sourcePath);
                if (fsModule.isDir(stats.mode)) {
                    copyRecursive(sourcePath, destPath);
                } else {
                    copyFile(sourcePath, destPath);
                }
                console.log(`复制成功：${sourcePath} -> ${destPath}`);
            } catch(err) {
                console.error(`复制 "${name}" 出错：`, err);
                showMessage(`复制 "${name}" 出错：${err.message}`, 'error');
            }
        });
        pendingOp = null;
        pendingItems = [];
        pendingOpBtn.style.display = "none";
        renderDirectory(currentPath);
        showMessage("复制操作完成。");
    }

    // --- 移动操作（两步） ---
    // 第一步：点击“移动”按钮，保存当前选中项为 pendingItems 并设定 pendingOp 状态
    function markMove() {
        if (selectedItems.length === 0) {
            showMessage("请先选择需要移动的文件或目录。");
            return;
        }
        pendingOp = "move";
        pendingItems = selectedItems.slice();
        pendingOpBtn.textContent = "移动到此处";
        pendingOpBtn.style.display = "inline-block";
        // showMessage("已标记移动操作，请进入目标目录后点击“移动到此处”按钮。");
        resetSelection();
    }
    // 第二步：在目标目录点击待执行按钮，执行移动操作
    function executeMove() {
        if (pendingOp !== "move" || pendingItems.length === 0) {
            showMessage("无待执行的移动操作。", "error");
            return;
        }
        pendingItems.forEach(sourcePath => {
            const name = baseName(sourcePath);
            const destPath = pathJoin(currentPath, name);
            if (sourcePath === destPath) {
                console.warn(`跳过移动：源与目标相同 (${sourcePath})`);
                return;
            }
            try {
                try {
                    fsModule.stat(destPath);
                    if (!confirm(`目标 "${name}" 已存在，是否覆盖？`)) return;
                } catch(e) {
                    // if (e.code !== 'ENOENT') throw e;
                }
                fsModule.rename(sourcePath, destPath);

                console.log(`移动成功：${sourcePath} -> ${destPath}`);
            } catch(err) {
                console.error(`移动 "${name}" 出错：`, err);
                showMessage(`移动 "${name}" 出错：${err.message}`, 'error');
            }
        });
        pendingOp = null;
        pendingItems = [];
        pendingOpBtn.style.display = "none";
        renderDirectory(currentPath);
        showMessage("移动操作完成。");
    }

    // --- 重命名操作 ---
    function doRenameAction() {
        if (selectedItems.length !== 1) {
            showMessage("请只选择一个文件或目录进行重命名。", 'error');
            return;
        }
        const sourcePath = selectedItems[0];
        const oldName = baseName(sourcePath);
        const newName = prompt("请输入新的名称：", oldName);
        if (!newName || newName.trim() === '') {
            showMessage("重命名操作取消或名称为空。", 'info');
            return;
        }
        if (newName.includes('/')) {
            showMessage("名称中不能包含斜杠字符。", 'error');
            return;
        }
        const destPath = pathJoin(currentPath, newName.trim());
        if (sourcePath === destPath) {
            showMessage("新名称与原名称相同。", 'info');
            return;
        }
        try {
            try {
                fsModule.stat(destPath);
                if (!confirm(`目标 "${newName.trim()}" 已存在，是否覆盖？`)) return;
            } catch(e) {
                // if (e.code !== 'ENOENT') throw e;
            }
            fsModule.rename(sourcePath, destPath);
            console.log(`重命名成功：${sourcePath} -> ${destPath}`);
        } catch(err) {
            console.error(`重命名 "${oldName}" 出错：`, err);
            showMessage(`重命名 "${oldName}" 出错：${err.message}`, 'error');
            return;
        }
        resetSelection();
        renderDirectory(currentPath);
        showMessage(`成功将 "${oldName}" 重命名为 "${newName.trim()}"`);
    }

    // --- 导入/导出 ---
    function handleImport() {
        if (!fsModule) return;
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(evt) {
                const data = evt.target.result;
                const destPath = pathJoin(currentPath, file.name);
                try {
                    fsModule.writeFile(destPath, data);
                    showMessage(`导入 "${file.name}" 成功。`);
                    renderDirectory(currentPath);
                } catch (error) {
                    console.error(`导入 "${file.name}" 出错：`, error);
                    showMessage(`导入 "${file.name}" 出错：${error.message}`, 'error');
                }
            };
            reader.readAsBinaryString(file);
        });
        document.body.appendChild(fileInput);
        fileInput.click();
        fileInput.remove();
    }
    function handleExport() {
        if (!fsModule) return;
        if (selectedItems.length !== 1) {
            showMessage("请仅选择一个文件进行导出。", 'error');
            return;
        }
        const filePath = selectedItems[0];
        let stats;
        try {
            stats = fsModule.stat(filePath);
        } catch (error) {
            showMessage("无法获取选中文件信息。", 'error');
            return;
        }
        if (fsModule.isDir(stats.mode)) {
            showMessage("目录不支持导出。", 'error');
            return;
        }
        try {
            const data = fsModule.readFile(filePath);
            const blob = new Blob([data], { type: "application/octet-stream" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = baseName(filePath);
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            showMessage(`文件 "${baseName(filePath)}" 导出成功。`);
        } catch (error) {
            console.error(`导出 "${baseName(filePath)}" 出错：`, error);
            showMessage(`导出 "${baseName(filePath)}" 出错：${error.message}`, 'error');
        }
    }

    // --- 目录渲染 ---
    function renderDirectory(path) {
        if (!fsModule) {
            console.error("FS Manager: Module.FS 未就绪！");
            list.innerHTML = '<li>错误：Module.FS 未找到，正在重试...</li>';
            pathDisplay.textContent = `路径：${path} (错误：FS未就绪)`;
            checkFSAvailability();
            return;
        }
        // 清空当前选中项，但保留 pending 状态（如果有待执行操作，就让按钮继续显示）
        resetSelection();
        currentPath = path;
        pathDisplay.textContent = `路径：${currentPath}`;
        list.innerHTML = '';
        document.getElementById('fs-manager-up-btn').disabled = (currentPath === '/');
        try {
            const items = fsModule.readdir(currentPath);
            const folders = [];
            const files = [];
            items.forEach(item => {
                if (item === '.' || item === '..') return;
                const itemPath = pathJoin(currentPath, item);
                try {
                    const stats = fsModule.stat(itemPath);
                    const isDir = fsModule.isDir(stats.mode);
                    (isDir ? folders : files).push({ name: item, path: itemPath, isDir });
                } catch (statError) {
                    console.warn(`获取状态失败：${itemPath}`, statError);
                    files.push({ name: item, path: itemPath, isDir: false, error: true });
                }
            });
            folders.sort((a, b) => a.name.localeCompare(b.name));
            files.sort((a, b) => a.name.localeCompare(b.name));
            const allItems = folders.concat(files);
            allItems.forEach(({ name, path: itemPath, isDir, error }) => {
                const li = document.createElement('li');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.addEventListener('change', (e) => {
                    updateSelection(itemPath, e.target.checked);
                });
                li.appendChild(checkbox);
                const span = document.createElement('span');
                span.className = 'item-name';
                span.textContent = name + (isDir ? '/' : '') + (error ? ' (不可访问)' : '');
                span.classList.add(isDir ? 'fs-manager-dir' : 'fs-manager-file');
                li.appendChild(span);
                if (isDir) {
                    li.addEventListener('click', (e) => {
                        if (e.target.tagName !== 'INPUT') {
                            renderDirectory(itemPath);
                        }
                    });
                }
                list.appendChild(li);
            });
            // 如果 pendingOp 存在，则确保待执行按钮持续显示
            if (pendingOp !== null) {
                pendingOpBtn.style.display = "inline-block";
            }
        } catch (error) {
            console.error(`读取目录 ${currentPath} 出错:`, error);
            list.innerHTML = `<li>列出目录出错：${error.message}</li>`;
            showMessage(`读取目录 "${currentPath}" 出错：${error.message}`, 'error');
        }
    }

    // --- 事件绑定 ---
    toggleButton.addEventListener('click', () => {
        const isHidden = container.style.display === 'none';
        container.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
            checkFSAvailability();
            if (fsModule) renderDirectory(currentPath);
        }
    });
    document.getElementById('fs-manager-close-btn').addEventListener('click', () => {
        container.style.display = 'none';
    });
    document.getElementById('fs-manager-up-btn').addEventListener('click', () => {
        if (currentPath === '/') return;
        const lastSlash = currentPath.lastIndexOf('/');
        renderDirectory(lastSlash === 0 ? '/' : currentPath.substring(0, lastSlash));
    });
    document.getElementById('fs-manager-mkdir-btn').addEventListener('click', () => {
        if (!fsModule) return;
        const newDirName = prompt("请输入新文件夹名称：");
        if (!newDirName || newDirName.trim() === '') {
            showMessage("创建文件夹操作取消或名称为空。", 'info');
            return;
        }
        if (newDirName.includes('/')) {
            showMessage("文件夹名称不能包含 '/'。", 'error');
            return;
        }
        const newDirPath = pathJoin(currentPath, newDirName.trim());
        try {
            fsModule.mkdir(newDirPath);
            renderDirectory(currentPath);
            showMessage(`创建文件夹 "${newDirName.trim()}" 成功。`);
        } catch (error) {
            if (error.code === 'EEXIST') {
                showMessage(`文件夹 "${newDirName.trim()}" 已存在。`, 'error');
            } else {
                console.error(`创建目录 ${newDirPath} 出错:`, error);
                showMessage(`创建文件夹出错：${error.message}`, 'error');
            }
        }
    });
    document.getElementById('fs-manager-refresh-btn').addEventListener('click', () => {
        if (fsModule) renderDirectory(currentPath);
    });
    // 复制、移动、重命名、删除、导入、导出
    document.getElementById('fs-manager-copy-btn').addEventListener('click', markCopy);
    document.getElementById('fs-manager-move-btn').addEventListener('click', markMove);
    document.getElementById('fs-manager-rename-btn').addEventListener('click', doRenameAction);
    document.getElementById('fs-manager-delete-btn').addEventListener('click', () => {
        if (!fsModule) return;
        if (selectedItems.length === 0) {
            showMessage("请先选择需要删除的文件或目录。");
            return;
        }
        if (!confirm("删除操作不可恢复，确认删除选中的项目吗？")) {
            return;
        }
        selectedItems.forEach(itemPath => {
            const name = baseName(itemPath);
            try {
                const stats = fsModule.stat(itemPath);
                if (fsModule.isDir(stats.mode)) {
                    fsModule.rmdir(itemPath);
                } else {
                    fsModule.unlink(itemPath);
                }
                console.log(`删除成功：${itemPath}`);
            } catch (err) {
                console.error(`删除失败：${itemPath}`, err);
                showMessage(`删除 "${name}" 出错：${err.message}`, 'error');
            }
        });
        renderDirectory(currentPath);
        resetSelection();
        showMessage("删除操作完成。");
    });
    document.getElementById('fs-manager-import-btn').addEventListener('click', handleImport);
    document.getElementById('fs-manager-export-btn').addEventListener('click', handleExport);
    // 待执行按钮，根据 pendingOp 分发复制或移动操作
    pendingOpBtn.addEventListener('click', () => {
        if (pendingOp === "copy") {
            executeCopy();
        } else if (pendingOp === "move") {
            executeMove();
        }
    });

    // --- FS 可用性检查 ---
    function checkFSAvailability() {
        if (typeof Module !== 'undefined' && Module.FS &&
            typeof Module.FS.stat === 'function' &&
            typeof Module.FS.readdir === 'function' &&
            typeof Module.FS.rename === 'function' &&
            typeof Module.FS.writeFile === 'function' &&
            typeof Module.FS.mkdir === 'function' &&
            typeof Module.FS.isDir === 'function')
        {
            console.log("FS Manager: Module.FS 已就绪！");
            fsModule = Module.FS;
            try {
                fsModule.stat(initialPath);
                currentPath = initialPath;
                console.log(`FS Manager: 初始路径 "${currentPath}" 验证成功。`);
            } catch(e) {
                console.warn(`FS Manager: 初始路径 "${initialPath}" 不可用，回退到根目录 '/'`, e);
                currentPath = '/';
            }
            if (container.style.display === 'flex') {
                renderDirectory(currentPath);
            } else {
                pathDisplay.textContent = `路径：${currentPath} (已就绪)`;
            }
            if (window.fsManagerCheckInterval) {
                clearInterval(window.fsManagerCheckInterval);
                window.fsManagerCheckInterval = null;
            }
        } else {
            console.log("FS Manager: 等待 Module.FS...");
            pathDisplay.textContent = `路径：${currentPath} (等待 FS...)`;
            if (!window.fsManagerCheckInterval) {
                window.fsManagerCheckInterval = setInterval(checkFSAvailability, 1500);
            }
        }
    }
    pathDisplay.textContent = `路径：${currentPath} (初始化...)`;
    setTimeout(checkFSAvailability, 500);
})();
