// ============================
// INITIALIZE MAP
// ============================
const map = L.map('map').setView([20, 20], 2);

let osm = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
        attribution: '© OpenStreetMap',
        crossOrigin: true
    }
);

let satellite = L.tileLayer(
    'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    {
        subdomains:['mt0','mt1','mt2','mt3'],
        crossOrigin: true
    }
);

let topo = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    {
        crossOrigin: true
    }
);


let currentLayer = L.featureGroup().addTo(map);
let loadedLayers = [];
let activeLayerId = null;
let selectedFeatures = [];
let selectedLayer = null;
let selectedFeature = null;
let featureLayerMap = {};
let overviewMap = null;
let overviewLayerGroup = null;
let lastUploadedFileName = null;
let lastUploadedFileExt = null;

const editableFeatures = new L.FeatureGroup();
const drawnItems = new L.FeatureGroup();
const drawnLayerItem = {
    id: 'drawn-features',
    name: 'Drawn Features',
    layer: drawnItems,
    visible: true,
    geojson: {
        type: 'FeatureCollection',
        features: []
    }
};

map.addLayer(editableFeatures);
map.addLayer(drawnItems);
L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);

// Global error/reporting helper to catch runtime issues during debugging
window.addEventListener('error', (ev) => {
    console.error('Global error caught:', ev.error || ev.message || ev);
    try { alert('An error occurred: ' + (ev.error?.message || ev.message || ev)); } catch (e) { /* ignore */ }
});
window.addEventListener('unhandledrejection', (ev) => {
    console.error('Unhandled promise rejection:', ev.reason);
    try { alert('Unhandled promise rejection: ' + (ev.reason?.message || ev.reason)); } catch (e) { /* ignore */ }
});

// ============================
// CUSTOM NOTIFICATION SYSTEM
// ============================

/**
 * Show a styled notification modal
 * @param {string} message - The message to display
 * @param {string} type - 'info', 'success', 'warning', or 'error'
 * @param {string} title - Optional title (defaults to type)
 * @param {function} onClose - Optional callback when closed
 */
function showNotification(message, type = 'info', title = null, onClose = null) {
    const overlay = document.getElementById('notificationOverlay');
    const modal = document.getElementById('notificationModal');
    const titleEl = document.getElementById('notificationTitle');
    const messageEl = document.getElementById('notificationMessage');
    const buttonsEl = document.getElementById('notificationButtons');
    
    if (!overlay || !modal) return;
    
    // Set modal type styling
    modal.className = `notification-modal ${type}`;
    
    // Set title
    const defaultTitles = {
        'info': 'Information',
        'success': 'Success',
        'warning': 'Warning',
        'error': 'Error',
        'drawing': 'Drawing Mode'
    };
    titleEl.textContent = title || defaultTitles[type] || 'Notification';
    
    // Set message
    messageEl.textContent = message;
    
    // Setup buttons
    buttonsEl.innerHTML = '<button class="btn-primary" onclick="closeNotification()">OK</button>';
    
    // Store callback
    window._notificationOnClose = onClose;
    
    // Show overlay
    overlay.classList.add('show');
}

/**
 * Close the notification modal
 */
function closeNotification() {
    const overlay = document.getElementById('notificationOverlay');
    if (!overlay) return;
    
    overlay.classList.remove('show');
    
    // Call callback if exists
    if (window._notificationOnClose && typeof window._notificationOnClose === 'function') {
        window._notificationOnClose();
        window._notificationOnClose = null;
    }
}

// Close notification when clicking outside
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('notificationOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeNotification();
            }
        });
    }
});

// Allow closing with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('notificationOverlay');
        if (overlay && overlay.classList.contains('show')) {
            closeNotification();
        }
    }
});

function activateDraw(shape) {
    const drawToolbar = drawControl && drawControl._toolbars && drawControl._toolbars.draw;
    const drawMode = drawToolbar && drawToolbar._modes && drawToolbar._modes[shape];
    if (drawMode && drawMode.handler && typeof drawMode.handler.enable === 'function') {
        disableAllEditing();
        drawMode.handler.enable();
        const info = document.getElementById('selectionInfo');
        if (info) {
            const shapeName = shape === 'polyline' ? 'Line' : shape === 'polygon' ? 'Polygon' : shape;
            info.innerHTML = `Drawing ${shapeName}. Click to place points and double-click or right-click to finish.`;
        }
        return;
    }
    showNotification('The draw tool is not available yet. Please try refreshing the page.', 'warning', 'Draw Tool Unavailable');
}

function saveLayerOriginalStyle(layer) {
    if (!layer || layer._originalStyle) return;
    const opts = layer.options || {};
    layer._originalStyle = {
        color: opts.color,
        fillColor: opts.fillColor,
        weight: opts.weight,
        opacity: opts.opacity,
        fillOpacity: opts.fillOpacity,
        dashArray: opts.dashArray
    };
}

function restoreLayerStyle(layer) {
    if (!layer || !layer.setStyle) return;
    const style = layer._originalStyle || {};
    layer.setStyle({
        color: style.color || '#444',
        fillColor: style.fillColor,
        weight: style.weight || 1,
        opacity: style.opacity != null ? style.opacity : 1,
        fillOpacity: style.fillOpacity != null ? style.fillOpacity : (layer.feature && /Polygon/.test(layer.feature.geometry?.type) ? 0.6 : 1),
        dashArray: style.dashArray
    });
}

function selectFeatureLayer(layer, showEditor = true) {
    if (!layer) return;
    disableAllEditing();
    if (selectedLayer && selectedLayer !== layer && selectedLayer.setStyle) {
        restoreLayerStyle(selectedLayer);
    }
    selectedLayer = layer;
    selectedFeature = layer.feature;
    if (!editableFeatures.hasLayer(layer)) {
        editableFeatures.addLayer(layer);
    }
    saveLayerOriginalStyle(layer);
    if (layer.setStyle) {
        layer.setStyle({ weight: 3, color: '#ff6f00' });
    }
    updateSelectionInfo(layer.feature, showEditor);
    updateStyleControls(layer);
    if (layer.feature) {
        bindPopupForLayer(layer, layer.feature);
    }
}

function setupOverviewMap() {
    const overviewContainer = document.getElementById('overviewMap');
    if (!overviewContainer) return;

    overviewMap = L.map('overviewMap', {
        attributionControl: false,
        zoomControl: false,
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        boxZoom: false,
        touchZoom: false,
        keyboard: false
    }).setView([20, 20], 2);

    L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '',
        crossOrigin: true
    }).addTo(overviewMap);

    overviewLayerGroup = L.featureGroup().addTo(overviewMap);
}

function getOverviewFeatureLabel(feature) {
    const props = feature.properties || {};
    const labelKeys = ['NAME', 'name', 'Name', 'NAME_0', 'NAME_LONG', 'COUNTRY', 'COUNTRYNAME'];
    for (const key of labelKeys) {
        if (props[key]) return props[key];
    }
    return null;
}

function updateOverviewMap() {
    if (!overviewMap || !overviewLayerGroup) return;
    overviewLayerGroup.clearLayers();

    const visibleLayers = loadedLayers.filter(item => item.visible && item.geojson);
    visibleLayers.forEach(item => {
        // Use the layer's stored style function if available (for thematic layers), otherwise use default
        let styleFunc = null;
        if (item.styleFunction) {
            styleFunc = item.styleFunction;
        } else if (item.choroplethStyle) {
            styleFunc = item.choroplethStyle;
        }
        
        const layerOptions = {
            onEachFeature: (feature, layer) => {
                const label = getOverviewFeatureLabel(feature);
                if (label) {
                    layer.bindTooltip(label, {
                        permanent: true,
                        direction: 'center',
                        className: 'overview-feature-label',
                        opacity: 0.85
                    });
                }
            }
        };
        
        if (styleFunc) {
            layerOptions.style = styleFunc;
        } else {
            layerOptions.style = {
                color: item.id === activeLayerId ? '#0a77f3' : '#2779af',
                weight: item.id === activeLayerId ? 1.5 : 1.0,
                fillColor: item.id === activeLayerId ? '#0a77f3' : '#2779af',
                fillOpacity: 0.7,
                opacity: 1
            };
        }
        
        L.geoJSON(item.geojson, layerOptions).addTo(overviewLayerGroup);
    });

    if (overviewLayerGroup.getLayers().length > 0) {
        // Prefer showing more geographic area when a layer is present (zoomed out)
        let fitted = false;
        try {
            const activeItem = loadedLayers.find(item => item.id === activeLayerId && item.visible && item.geojson);
            if (activeItem && activeItem.geojson) {
                const activeGeo = L.geoJSON(activeItem.geojson);
                const ab = activeGeo.getBounds();
                if (ab && ab.isValid && ab.isValid()) {
                    // Use larger pad to include surrounding area, and limit maxZoom lower to zoom out
                    overviewMap.fitBounds(ab.pad(1.2), { padding: [18, 18], maxZoom: 2 });
                    fitted = true;
                }
            }
        } catch (e) {
            // fall back to group bounds
        }

        if (!fitted) {
            overviewMap.fitBounds(overviewLayerGroup.getBounds().pad(1.0), { padding: [18, 18], maxZoom: 2 });
        }
    } else {
        overviewMap.setView([20, 0], 2);
    }

    setTimeout(() => overviewMap.invalidateSize(), 100);
}

// ============================
// MAP STATISTICS
// ============================

function populateStatisticsFields() {
    const active = getActiveLayerItem();
    if (!active || !active.geojson) {
        document.getElementById('statisticsField').innerHTML = '<option value="">-- Select field --</option>';
        return;
    }

    const props = findFirstFeatureProperties(active.geojson);
    const keys = props ? Object.keys(props) : [];
    
    // Filter to only numeric fields
    const numericKeys = keys.filter(key => {
        const values = active.geojson.features.map(f => f.properties ? f.properties[key] : null);
        return values.some(v => !isNaN(v) && v !== null && v !== '');
    });

    const fieldSelect = document.getElementById('statisticsField');
    fieldSelect.innerHTML = '<option value="">-- Select field --</option>';
    numericKeys.forEach(k => {
        const option = document.createElement('option');
        option.value = k;
        option.textContent = k;
        fieldSelect.appendChild(option);
    });
}

function updateMapStatistics() {
    const active = getActiveLayerItem();
    const fieldName = document.getElementById('statisticsField').value;
    const contentDiv = document.getElementById('statisticsContent');

    if (!fieldName || !active || !active.geojson) {
        contentDiv.innerHTML = '<p style="color: #9ca3af; font-size: 12px;">Select a field to view statistics</p>';
        return;
    }

    const values = active.geojson.features
        .map(f => f.properties ? f.properties[fieldName] : null)
        .filter(v => !isNaN(v) && v !== null && v !== '')
        .map(v => parseFloat(v));

    if (values.length === 0) {
        contentDiv.innerHTML = '<p style="color: #9ca3af; font-size: 12px;">No numeric data available for this field</p>';
        return;
    }

    const total = values.reduce((a, b) => a + b, 0);
    const average = total / values.length;
    const highest = Math.max(...values);
    const lowest = Math.min(...values);

    const html = `
        <div class="stat-row">
            <span class="stat-label">Total:</span>
            <span class="stat-value">${total.toFixed(2)}</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Highest:</span>
            <span class="stat-value">${highest.toFixed(2)}</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Lowest:</span>
            <span class="stat-value">${lowest.toFixed(2)}</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Average:</span>
            <span class="stat-value">${average.toFixed(2)}</span>
        </div>
    `;
    
    contentDiv.innerHTML = html;
}

const layoutSettings = {
    title: 'Map Layout - Editable Title',
    subtitle: 'Exported from Web GIS Application',
    size: 'a4-landscape'
};

function applyLayoutSize() {
    const pageLayout = document.getElementById('pageLayout');
    if (!pageLayout) return;

    const size = document.getElementById('layoutSizeSelect')?.value || layoutSettings.size;
    layoutSettings.size = size;

    switch (size) {
        case 'a4-portrait':
            pageLayout.style.width = '820px';
            pageLayout.style.minHeight = '1090px';
            break;
        case 'letter-portrait':
            pageLayout.style.width = '820px';
            pageLayout.style.minHeight = '1030px';
            break;
        case 'letter-landscape':
            pageLayout.style.width = '1100px';
            pageLayout.style.minHeight = '770px';
            break;
        default:
            pageLayout.style.width = '1120px';
            pageLayout.style.minHeight = '760px';
            break;
    }

    if (map && map.invalidateSize) {
        window.setTimeout(() => map.invalidateSize(), 150);
    }
}

function updateLayoutSettings() {
    applyLayoutSize();
}

function setupFeatureEditPanel() {
    const panel = document.getElementById('featureEditPanel');
    const panelSave = document.getElementById('saveFeatureEditsBtn');
    const closeBtn = document.getElementById('closeFeatureEdit');

    if (panelSave) {
        panelSave.addEventListener('click', () => {
            saveEdits();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (panel) panel.classList.add('hidden');
            // Restore editor to sidebar if it was moved
            const editor = document.getElementById('attributeEditor');
            const origParent = window._attributeEditorOriginalParent;
            const next = window._attributeEditorNextSibling;
            if (editor && origParent && origParent !== editor.parentNode) {
                if (next) origParent.insertBefore(editor, next);
                else origParent.appendChild(editor);
            }
        });
    }
}

function setupEditableLayoutText() {
    const titleElement = document.getElementById('layoutTitle');
    const subtitleElement = document.getElementById('layoutSubtitle');
    const sizeSelect = document.getElementById('layoutSizeSelect');

    if (titleElement) {
        titleElement.innerText = layoutSettings.title;
        titleElement.addEventListener('blur', () => {
            layoutSettings.title = titleElement.innerText.trim() || 'Map Layout';
            titleElement.innerText = layoutSettings.title;
        });
        titleElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleElement.blur();
            }
        });
    }

    if (subtitleElement) {
        subtitleElement.innerText = layoutSettings.subtitle;
        subtitleElement.addEventListener('blur', () => {
            layoutSettings.subtitle = subtitleElement.innerText.trim() || 'Exported from Web GIS Application';
            subtitleElement.innerText = layoutSettings.subtitle;
        });
        subtitleElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                subtitleElement.blur();
            }
        });
    }

    if (sizeSelect) {
        sizeSelect.value = layoutSettings.size;
        sizeSelect.addEventListener('change', applyLayoutSize);
    }
}

window.addEventListener('load', () => {
    setupFeatureEditPanel();
    setupEditableLayoutText();
    applyLayoutSize();
    setupOverviewMap();
    updateOverviewMap();
    // Restore default basemap selection on load
    try { changeBasemap(); } catch (e) { /* ignore if function missing */ }
});

// ============================
// DRAW TOOLS
// ============================

const drawControl = new L.Control.Draw({
    draw: {
        polygon: true,
        polyline: true,
        rectangle: true,
        circle: false,
        marker: false,
        circlemarker: false
    },
    edit: {
        featureGroup: editableFeatures
    }
});

map.addControl(drawControl);

function attachLayerInteractionHandlers(layer) {
    if (!layer) return;
    if (!layer.feature) {
        layer.feature = layer.toGeoJSON();
    }
    if (!layer.feature.properties) {
        layer.feature.properties = {};
    }

    const ensurePopup = () => {
        if (!layer._popupBound) {
            bindPopupForLayer(layer, layer.feature);
            layer._popupBound = true;
        }
    };

    layer.on('click', function(e) {
        if (e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
        }
        ensurePopup();
        selectFeatureLayer(layer, true);
        selectedFeatures = [layer.feature];
        selectedFeature = layer.feature;
        enableFeatureEditing(layer);
        try {
            if (e && e.latlng) layer.openPopup(e.latlng);
            else layer.openPopup();
        } catch (err) {
            console.warn('Error opening popup on drawn feature', err);
        }
    });

    layer.on('dblclick', function(e) {
        if (e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
        }
        ensurePopup();
        selectFeatureLayer(layer, true);
        selectedFeatures = [layer.feature];
        selectedFeature = layer.feature;
        enableFeatureEditing(layer);
        try {
            if (e && e.latlng) layer.openPopup(e.latlng);
            else layer.openPopup();
        } catch (err) {
            console.warn('Error opening popup after selecting drawn feature', err);
        }
    });
}

map.on('draw:created', function(event) {
    const layer = event.layer;
    if (!layer) return;
    if (!layer.feature) {
        layer.feature = layer.toGeoJSON();
    }
    layer.feature.properties = layer.feature.properties || {};
    drawnItems.addLayer(layer);
    editableFeatures.addLayer(layer);
    attachLayerInteractionHandlers(layer);
    selectFeatureLayer(layer, true);
    selectedFeatures = [layer.feature];
    selectedFeature = layer.feature;
    if (typeof renderAttributeEditor === 'function') {
        renderAttributeEditor(layer.feature, true);
    }
    const panel = document.getElementById('featureEditPanel');
    if (panel) {
        panel.classList.remove('hidden');
    }
    enableFeatureEditing(layer);
    try {
        if (drawnItems.getBounds && drawnItems.getLayers().length > 0) {
            map.fitBounds(drawnItems.getBounds(), { padding: [20, 20] });
        }
    } catch (err) {
        // ignore bounds errors for single feature geometries
    }
});

map.on('draw:edited', function(event) {
    const layers = event.layers;
    layers.eachLayer(function(layer) {
        if (!layer) return;
        if (layer.feature) {
            layer.feature = layer.toGeoJSON();
        }
        if (selectedLayer === layer) {
            selectedFeature = layer.feature;
            bindPopupForLayer(layer, layer.feature);
            updateSelectionInfo(layer.feature, true);
        }
    });
});

map.on('draw:deleted', function(event) {
    const layers = event.layers;
    layers.eachLayer(function(layer) {
        if (selectedLayer === layer) {
            resetSelection();
        }
    });
});

function startLineDraw() {
    const drawToolbar = drawControl && drawControl._toolbars && drawControl._toolbars.draw;
    const polylineMode = drawToolbar && drawToolbar._modes && drawToolbar._modes.polyline;
    if (polylineMode && polylineMode.handler && typeof polylineMode.handler.enable === 'function') {
        polylineMode.handler.enable();
        showNotification('Click to add vertices to your line. Double-click or right-click to finish.', 'info', 'Drawing Mode Activated');
        return;
    }
    showNotification('Unable to start line drawing. Please try refreshing the page.', 'warning', 'Draw Tool Error');
}


// ============================
// SHAPEFILE UPLOAD
// ============================

// ============================
// LOCALSTORAGE PERSISTENCE
// ============================

function saveGeoJSONToStorage(layerArray) {
    try {
        localStorage.setItem('webmapGeoJSON', JSON.stringify(layerArray));
    } catch (e) {
        console.warn('Could not save to localStorage:', e);
    }
}

function loadGeoJSONFromStorage() {
    try {
        const stored = localStorage.getItem('webmapGeoJSON');
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
        if (parsed.type === 'FeatureCollection') return [{ name: 'Layer 1', geojson: parsed }];
        return null;
    } catch (e) {
        console.warn('Could not load from localStorage:', e);
        return null;
    }
}

function forEachFeatureLayer(callback) {
    const visited = new Set();
    const processLayer = (layer) => {
        if (!layer || visited.has(layer)) return;
        visited.add(layer);

        if (layer instanceof L.FeatureGroup || layer instanceof L.LayerGroup) {
            layer.eachLayer(processLayer);
        } else if (layer.feature) {
            callback(layer);
        }
    };

    processLayer(currentLayer);
    processLayer(drawnItems);
}

function getCurrentLayerGeoJSON() {
    const features = [];
    forEachFeatureLayer(feature => {
        const geo = feature.toGeoJSON();
        if (geo && geo.type === 'FeatureCollection') {
            features.push(...geo.features);
        } else if (geo && geo.type === 'Feature') {
            features.push(geo);
        }
    });
    return {
        type: 'FeatureCollection',
        features
    };
}

function updateLayerList() {
    const list = document.getElementById('layerList');
    const activeSelect = document.getElementById('activeLayerSelect');
    if (!list || !activeSelect) return;

    list.innerHTML = '';
    activeSelect.innerHTML = '<option value="">-- Select layer --</option>';

    loadedLayers.forEach((item, index) => {
        const row = document.createElement('li');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '6px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.visible;
        checkbox.addEventListener('change', () => toggleLayerVisibility(item.id, checkbox.checked));

        const label = document.createElement('label');
        label.style.color = '#f8fafc';
        label.style.fontSize = '13px';
        label.style.cursor = 'pointer';
        label.style.padding = '2px 4px';
        label.style.borderRadius = '4px';
        label.style.flex = '1';
        label.innerText = item.name || `Layer ${index + 1}`;
        label.addEventListener('click', () => setActiveLayer(item.id));

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.innerText = '✎';
        editBtn.style.background = 'transparent';
        editBtn.style.border = 'none';
        editBtn.style.color = '#60a5fa';
        editBtn.style.cursor = 'pointer';
        editBtn.style.fontSize = '16px';
        editBtn.style.padding = '0 4px';
        editBtn.style.flex = '0 0 auto';
        editBtn.title = 'Rename layer';
        
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentName = label.innerText;
            label.style.display = 'none';
            editBtn.style.display = 'none';
            
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentName;
            input.style.flex = '1';
            input.style.color = '#f8fafc';
            input.style.fontSize = '13px';
            input.style.padding = '2px 4px';
            input.style.border = '1px solid #2563eb';
            input.style.borderRadius = '4px';
            input.style.background = '#1f2937';
            input.style.boxSizing = 'border-box';
            
            row.appendChild(input);
            input.focus();
            input.select();
            
            const finishEdit = () => {
                const newName = input.value.trim();
                if (newName) {
                    item.name = newName;
                    label.innerText = newName;
                    saveGeoJSONToStorage(loadedLayers.map(l => ({ name: l.name, geojson: l.geojson })));
                }
                label.style.display = '';
                editBtn.style.display = '';
                try {
                    row.removeChild(input);
                } catch (e) {
                    // Input already removed
                }
            };
            
            input.addEventListener('blur', finishEdit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    finishEdit();
                } else if (e.key === 'Escape') {
                    label.style.display = '';
                    editBtn.style.display = '';
                    try {
                        row.removeChild(input);
                    } catch (e) {
                        // Input already removed
                    }
                }
            });
        });

        // Delete button
        const deleteBtn = document.createElement('button');
        row.appendChild(checkbox);
        row.appendChild(label);
        row.appendChild(editBtn);
        list.appendChild(row);

        const option = document.createElement('option');
        option.value = item.id;
        option.innerText = item.name || `Layer ${index + 1}`;
        activeSelect.appendChild(option);
    });

    if (activeLayerId && loadedLayers.some(item => item.id === activeLayerId)) {
        activeSelect.value = activeLayerId;
    } else if (loadedLayers.length > 0) {
        activeLayerId = loadedLayers[0].id;
        activeSelect.value = activeLayerId;
    }
    updateActiveLayerFields();
    updateOverviewMap();
}

function toggleLayerVisibility(id, visible) {
    const layerInfo = loadedLayers.find(item => item.id === id);
    if (!layerInfo) return;
    layerInfo.visible = visible;
    if (visible) {
        map.addLayer(layerInfo.layer);
    } else {
        map.removeLayer(layerInfo.layer);
    }
}

function setActiveLayer(id) {
    if (!id) return;
    activeLayerId = id;
    updateLayerList();
    updateOverviewMap();
    populateStatisticsFields();
}

function getActiveLayerItem() {
    return loadedLayers.find(item => item.id === activeLayerId) || loadedLayers[0] || null;
}

function findFirstFeatureProperties(geojson) {
    if (!geojson || !Array.isArray(geojson.features)) return null;
    for (const feature of geojson.features) {
        if (feature && feature.properties && Object.keys(feature.properties).length > 0) {
            return feature.properties;
        }
    }
    return geojson.features[0]?.properties || null;
}

function updateActiveLayerFields() {
    const active = getActiveLayerItem();
    if (!active) return;
    const props = findFirstFeatureProperties(active.geojson);
    const keys = props ? Object.keys(props) : [];
    const thematicSelect = document.getElementById('thematicField');
    const choroplethX = document.getElementById('choroplethFieldX');
    const choroplethY = document.getElementById('choroplethFieldY');
    const popupSel = document.getElementById('popupFields');

    if (thematicSelect) {
        thematicSelect.innerHTML = '<option value="">-- Select field --</option>';
        keys.forEach(k => thematicSelect.appendChild(new Option(k, k)));
    }
    if (choroplethX) {
        choroplethX.innerHTML = '<option value="">X field</option>';
        keys.forEach(k => choroplethX.appendChild(new Option(k, k)));
    }
    if (choroplethY) {
        choroplethY.innerHTML = '<option value="">Y field</option>';
        keys.forEach(k => choroplethY.appendChild(new Option(k, k)));
    }
    if (popupSel) {
        popupSel.innerHTML = '';
        keys.forEach(k => popupSel.appendChild(new Option(k, k)));
    }
    
}



function normalizeGeoJSON(input) {
    if (!input) return null;
    if (input.type === 'FeatureCollection' && Array.isArray(input.features)) {
        return input;
    }
    if (input.type === 'Feature') {
        return { type: 'FeatureCollection', features: [input] };
    }
    if (Array.isArray(input)) {
        return {
            type: 'FeatureCollection',
            features: input.filter(f => f && f.type === 'Feature')
        };
    }
    if (input.features && Array.isArray(input.features)) {
        return { type: 'FeatureCollection', features: input.features };
    }
    const combined = [];
    Object.values(input).forEach(value => {
        if (value && Array.isArray(value.features)) {
            combined.push(...value.features);
        }
    });
    return combined.length ? { type: 'FeatureCollection', features: combined } : null;
}

function addShapefileLayer(geojson, name) {
    const normalizedGeoJSON = normalizeGeoJSON(geojson);
    if (!normalizedGeoJSON || !Array.isArray(normalizedGeoJSON.features) || normalizedGeoJSON.features.length === 0) {
        alert('The uploaded file did not contain valid GeoJSON features.');
        console.error('Invalid GeoJSON input:', geojson);
        return;
    }
    const layerId = `layer-${loadedLayers.length + 1}`;
    const newLayer = L.geoJSON(normalizedGeoJSON, {
        onEachFeature: function(feature, layer) {
            // OPTIMIZATION: Defer popup binding until click to prevent freezing on large shapefiles
            // Instead of binding immediately, we'll bind on-demand when the user clicks
            
            // Single-click opens popup (no auto-select) to avoid accidental selection
            layer.on('click', function(e) {
                try {
                    if (e && typeof e.stopPropagation === 'function') {
                        e.stopPropagation();
                    }
                } catch (err) {
                    // ignore
                }

                if (!layer._popupBound) {
                    try {
                        bindPopupForLayer(layer, feature);
                        layer._popupBound = true;
                    } catch (err) {
                        console.error('Error binding popup:', err);
                    }
                }

                try {
                    if (e && e.latlng) layer.openPopup(e.latlng);
                    else layer.openPopup();
                } catch (err) {
                    console.error('Error opening popup:', err);
                }
            });

            // Double-click selects the feature for editing
            layer.on('dblclick', function(e) {
                try {
                    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                } catch (err) {}
                try {
                    if (!layer._popupBound) {
                        bindPopupForLayer(layer, feature);
                        layer._popupBound = true;
                    }
                } catch (err) {}
                selectFeatureLayer(layer, true);
                selectedFeatures = [feature];
                selectedFeature = feature;
                enableFeatureEditing(layer);
                try { layer.openPopup(e && e.latlng ? e.latlng : undefined); } catch (err) {}
            });
        }
    });

    let featureIndex = 0;
    newLayer.eachLayer(layer => {
        editableFeatures.addLayer(layer);
        featureIndex += 1;
        const props = layer.feature.properties || {};
        const firstKey = Object.keys(props)[0];
        const label = firstKey ? `${props[firstKey]} (${featureIndex})` : `Feature ${featureIndex}`;
        const featureId = `${layerId}-feature-${featureIndex}`;
        layer._featureId = featureId;
        featureLayerMap[featureId] = layer;
        // OPTIMIZATION: Removed layer.editing.enable() call for each feature to prevent unnecessary 
        // overhead and potential infinite loops. Editing is enabled on-demand when selected.
    });

    const first = findFirstFeatureProperties(normalizedGeoJSON);
    if (first) {
        const keys = Object.keys(first);

        const thematicSelect = document.getElementById('thematicField');
        const choroplethX = document.getElementById('choroplethFieldX');
        const choroplethY = document.getElementById('choroplethFieldY');
        const popupSel = document.getElementById('popupFields');

        if (thematicSelect && thematicSelect.options.length <= 1) {
            thematicSelect.innerHTML = '<option value="">-- Select field --</option>';
            keys.forEach(k => thematicSelect.appendChild(new Option(k, k)));
        }
        if (choroplethX && choroplethX.options.length <= 1) {
            choroplethX.innerHTML = '<option value="">X field</option>';
            keys.forEach(k => choroplethX.appendChild(new Option(k, k)));
        }
        if (choroplethY && choroplethY.options.length <= 1) {
            choroplethY.innerHTML = '<option value="">Y field</option>';
            keys.forEach(k => choroplethY.appendChild(new Option(k, k)));
        }
        if (popupSel && popupSel.options.length === 0) {
            keys.forEach(k => popupSel.appendChild(new Option(k, k)));
        }
    }

    currentLayer.addLayer(newLayer);
    map.fitBounds(currentLayer.getBounds());
    loadedLayers.push({ id: layerId, name: name || `Layer ${loadedLayers.length + 1}`, layer: newLayer, visible: true, geojson: normalizedGeoJSON });
    activeLayerId = layerId;
    updateLayerList();
    populateStatisticsFields();
    saveGeoJSONToStorage(loadedLayers.map(item => ({ name: item.name, geojson: item.geojson })));
    resetSelection();
}

const shpUploadInput = document.getElementById('shpUpload');
if (!shpUploadInput) {
    console.error('Upload input #shpUpload is missing from the page.');
} else {
    console.log('[setup] shpUpload input found, shp parser available:', typeof shp);
    shpUploadInput.addEventListener('change', async (e) => {
        console.log('[upload] change event fired');
        const file = e.target.files && e.target.files[0];
        if (!file) {
            console.warn('[upload] no file selected');
            return;
        }

        const fileName = file.name.replace(/\.[^/.]+$/, '');
        const fileExt = file.name.split('.').pop().toLowerCase();
        console.log('[upload] selected file', file.name, file.size, file.type);
        lastUploadedFileName = file.name;
        lastUploadedFileExt = fileExt;

        try {
            if (fileExt === 'zip' && typeof shp !== 'function') {
                console.error('shp.js is not loaded or the shapefile parser is unavailable.');
                alert('Shapefile parser is not loaded. Reload the page and try again.');
                return;
            }

            let parsedGeoJSON = null;
            
            if (fileExt === 'zip') {
                const arrayBuffer = await file.arrayBuffer();
                console.log('[upload] parsing shapefile zip...');
                const parsed = await shp(arrayBuffer);
                console.log('[upload] shapefile parse result:', parsed);
                parsedGeoJSON = normalizeGeoJSON(parsed);
            } else if (fileExt === 'geojson' || fileExt === 'json') {
                const text = await file.text();
                const parsed = JSON.parse(text);
                console.log('[upload] geojson parse result:', parsed && parsed.type, parsed && parsed.features && parsed.features.length);
                parsedGeoJSON = normalizeGeoJSON(parsed);
            } else {
                alert('Please upload a .zip (shapefile) or .geojson/.json file');
                return;
            }

            if (!parsedGeoJSON || !Array.isArray(parsedGeoJSON.features) || parsedGeoJSON.features.length === 0) {
                console.error('[upload] normalized GeoJSON is invalid or empty', parsedGeoJSON);
                alert('Uploaded file did not contain any valid features. Check the console for details.');
                return;
            }

            console.log('[upload] adding layer to map', parsedGeoJSON.features.length);
            addShapefileLayer(parsedGeoJSON, fileName);
        } catch (err) {
            console.error('Error loading file:', err);
            alert('Error loading file: ' + (err.message || err));
        }
    });
}

// Ensure clicking the styled upload label opens the file picker (works around some browser quirks)
const uploadLabelEl = document.getElementById('uploadLabel');
if (uploadLabelEl) {
    uploadLabelEl.addEventListener('click', (ev) => {
        ev.preventDefault();
        const inp = document.getElementById('shpUpload');
        if (inp) inp.click();
    });
}


function getThematicColors(scheme) {
    const schemes = {
        blues: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
        greens: ['#f7fcfd', '#c7e9c4', '#7ebdc2', '#2b8a8a', '#08589e'],
        reds: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc8d59', '#e34a33'],
        purples: ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc', '#807dba'],
        viridis: ['#fde724', '#31688e', '#22a884', '#3b528b', '#440154'],
        rainbow: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff'],
        grayscale: ['#f7f7f7', '#cccccc', '#999999', '#666666', '#000000']
    };
    return schemes[scheme] || schemes.blues;
}

function getBivariateColors(scheme) {
    const schemes = {
        blues: [
            ['#f7fbff', '#deebf7', '#9ecae1', '#6baed6'],
            ['#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
            ['#6baed6', '#3182bd', '#08519c', '#084594'],
            ['#08519c', '#084594', '#08306b', '#041f3a']
        ],
        greens: [
            ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b'],
            ['#c7e9c0', '#a1d99b', '#74c476', '#41ab5d'],
            ['#74c476', '#41ab5d', '#238b45', '#006d2c'],
            ['#238b45', '#006d2c', '#00441b', '#002b16']
        ],
        reds: [
            ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272'],
            ['#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a'],
            ['#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c'],
            ['#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d']
        ],
        purples: [
            ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc'],
            ['#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8'],
            ['#dadaeb', '#bcbddc', '#9e9ac8', '#807dba'],
            ['#bcbddc', '#9e9ac8', '#807dba', '#6a51a3']
        ],
        viridis: [
            ['#fde725', '#c6dc10', '#7bc541', '#3f9f71'],
            ['#c6dc10', '#7bc541', '#3f9f71', '#2a788e'],
            ['#7bc541', '#3f9f71', '#2a788e', '#414487'],
            ['#3f9f71', '#2a788e', '#414487', '#440154']
        ],
        rainbow: [
            ['#f7f7f7', '#fbb4ae', '#b3cde3', '#ccebc5'],
            ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4'],
            ['#b3cde3', '#ccebc5', '#decbe4', '#fed9a6'],
            ['#ccebc5', '#decbe4', '#fed9a6', '#ffffcc']
        ],
        grayscale: [
            ['#f7f7f7', '#e5e5e5', '#cccccc', '#b2b2b2'],
            ['#d9d9d9', '#bdbdbd', '#9e9e9e', '#7f7f7f'],
            ['#969696', '#737373', '#525252', '#333333'],
            ['#525252', '#333333', '#1a1a1a', '#000000']
        ]
    };
    return schemes[scheme] || schemes.blues;
}

function buildBivariateLegend(xField, yField, breaksX, breaksY, colors) {
    const legend = document.getElementById('legend');
    if (!legend) return;

    const titleText = `${yField} vs ${xField}`;
    legend.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'legend-title';
    title.innerText = titleText;
    legend.appendChild(title);

    const table = document.createElement('table');
    table.className = 'bivariate-legend';
    for (let i = colors.length - 1; i >= 0; i--) {
        const row = document.createElement('tr');
        for (let j = 0; j < colors[i].length; j++) {
            const cell = document.createElement('td');
            // Use inline SVG inside table cell so printed output retains color
            cell.innerHTML = `<svg width="28" height="28" xmlns="http://www.w3.org/2000/svg"><rect width="28" height="28" fill="${colors[i][j]}" /></svg>`;
            row.appendChild(cell);
        }
        table.appendChild(row);
    }
    legend.appendChild(table);

    const axis = document.createElement('div');
    axis.className = 'bivariate-axis-labels';
    axis.innerHTML = `<div class="bivariate-axis y-axis">Low ${yField} ↑ High</div><div class="bivariate-axis x-axis">Low ${xField} → High</div>`;
    legend.appendChild(axis);
}

// ============================
// THEMATIC MAP
// ============================

function applyThematic() {
    const type = document.getElementById('choroplethType').value;
    const colorScheme = document.getElementById('thematicColorScheme').value;
    const field = document.getElementById('thematicField').value;
    const xField = document.getElementById('choroplethFieldX').value;
    const yField = document.getElementById('choroplethFieldY').value;

    if (!currentLayer) {
        alert('No layer loaded');
        return;
    }

    if (type === 'bivariate') {
        if (!xField || !yField) {
            alert('Please select both X and Y fields for bivariate mapping');
            return;
        }
        if (xField === yField) {
            alert('Choose two different fields for bivariate mapping');
            return;
        }

        const valuesX = [];
        const valuesY = [];
        forEachFeatureLayer(l => {
            const vx = parseFloat(l.feature.properties[xField]);
            const vy = parseFloat(l.feature.properties[yField]);
            if (!isNaN(vx) && !isNaN(vy)) {
                valuesX.push(vx);
                valuesY.push(vy);
            }
        });

        if (valuesX.length === 0 || valuesY.length === 0) {
            alert('Selected fields must be numeric for bivariate mapping');
            return;
        }

        valuesX.sort((a, b) => a - b);
        valuesY.sort((a, b) => a - b);

        const breaksX = [
            valuesX[Math.floor(valuesX.length / 4)],
            valuesX[Math.floor(valuesX.length / 2)],
            valuesX[Math.floor((3 * valuesX.length) / 4)]
        ];
        const breaksY = [
            valuesY[Math.floor(valuesY.length / 4)],
            valuesY[Math.floor(valuesY.length / 2)],
            valuesY[Math.floor((3 * valuesY.length) / 4)]
        ];
        const colors = getBivariateColors(colorScheme);

        forEachFeatureLayer(layer => {
            const vx = parseFloat(layer.feature.properties[xField]);
            const vy = parseFloat(layer.feature.properties[yField]);
            let ix = 0;
            while (ix < breaksX.length && vx > breaksX[ix]) ix++;
            let iy = 0;
            while (iy < breaksY.length && vy > breaksY[iy]) iy++;
            const fill = colors[iy] && colors[iy][ix] ? colors[iy][ix] : colors[colors.length - 1][colors[0].length - 1];
            layer.setStyle({
                color: '#444',
                weight: 1,
                fillColor: fill,
                fillOpacity: 0.83
            });
        });

        buildBivariateLegend(xField, yField, breaksX, breaksY, colors);
        return;
    }

    if (!field) {
        alert('Please select a field for thematic mapping');
        return;
    }

    // collect numeric values
    const values = [];
    forEachFeatureLayer(l => {
        const v = l.feature.properties[field];
        const n = parseFloat(v);
        if (!isNaN(n)) values.push(n);
    });

    if (values.length === 0) {
        // fallback: random coloring
        forEachFeatureLayer(layer => {
            const value = Math.random() * 100;
            let color = value > 50 ? 'red' : 'green';
            layer.setStyle({
                color: color,
                fillColor: color,
                fillOpacity: 0.6
            });
        });
        return;
    }

    values.sort((a, b) => a - b);

    // compute 5 quantile breaks
    const breaks = [];
    const classes = 5;
    for (let i = 1; i < classes; i++) {
        const idx = Math.floor((i * values.length) / classes);
        breaks.push(values[idx]);
    }

    const colors = getThematicColors(colorScheme);

    forEachFeatureLayer(layer => {
        const v = parseFloat(layer.feature.properties[field]);
        let idx = 0;
        while (idx < breaks.length && v > breaks[idx]) idx++;
        const fill = colors[idx] || colors[colors.length - 1];
        layer.setStyle({
            color: '#444',
            weight: 1,
            fillColor: fill,
            fillOpacity: 0.83
        });
    });

    updateLegend(field, breaks, colors);
}

// Build popup HTML for a feature using selected fields and style inputs
function buildPopupHtml(props) {
    const popupSel = document.getElementById('popupFields');
    const selected = Array.from(popupSel.selectedOptions).map(o => o.value);
    // Exclude common style-related properties from popup display
    const excludedKeys = new Set(['fillColor', 'color', 'stroke', 'strokeColor', 'stroke-width', 'strokeWidth', 'fill', 'strokeOpacity', 'fillOpacity']);

    const allKeys = Object.keys(props || {});
    const filteredKeys = allKeys.filter(k => !excludedKeys.has(k));

    // If popup fields are explicitly selected, use them (but filter out any style keys)
    let fields = [];
    if (selected && selected.length > 0) {
        fields = selected.filter(k => !excludedKeys.has(k));
    } else {
        fields = filteredKeys.length > 0 ? filteredKeys : allKeys;
    }

    let html = '<div style="line-height:1.5;">';
    fields.forEach(f => {
        const val = props && (props[f] !== undefined && props[f] !== null) ? props[f] : '';
        html += `<b>${f}</b>: ${val}<br>`;
    });
    html += '</div>';
    return html;
}

// Bind styled popup to a layer
function bindPopupForLayer(layer, feature) {
    const props = feature.properties || {};

    const content = buildPopupHtml(props);

    // Use the .popup-preview class for styling so popup appearance can be
    // controlled via CSS variables or external automation.
    const styled = `<div class="popup-preview">${content}</div>`;

    layer.bindPopup(styled, { maxWidth: 400, className: 'custom-popup' });
    layer._popupBound = true;
}

function buildLegendLabels(field, breaks) {
    const labels = [];
    if (!breaks || breaks.length === 0) {
        return labels;
    }

    const roundValue = value => Math.round(value);
    labels.push(`≤ ${roundValue(breaks[0])}`);
    for (let i = 1; i < breaks.length; i++) {
        labels.push(`${roundValue(breaks[i-1])} - ${roundValue(breaks[i])}`);
    }
    labels.push(`> ${roundValue(breaks[breaks.length - 1])}`);
    return labels;
}

function updateLegend(field, breaks, colors) {
    const legend = document.getElementById('legend');
    if (!legend) return;

    const titleText = field;
    const labels = buildLegendLabels(field, breaks);

    legend.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'legend-title';
    title.innerText = titleText;
    legend.appendChild(title);

    for (let i = 0; i < colors.length; i++) {
        const item = document.createElement('div');
        item.className = 'legend-item';

        const swatch = document.createElement('span');
        swatch.className = 'legend-swatch';
        // Use inline SVG for swatch so print preserves fill color in most browsers
        swatch.innerHTML = `<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" rx="3" fill="${colors[i]}" /></svg>`;

        const label = document.createElement('span');
        label.innerText = labels[i] || '';

        item.appendChild(swatch);
        item.appendChild(label);
        legend.appendChild(item);
    }
}

function updateLegendTitle() {
    if (!currentLayer) {
        alert('Load a layer first to update the legend title.');
        return;
    }
    const field = document.getElementById('thematicField').value || 'Field';
    const legend = document.getElementById('legend');
    if (legend && legend.innerHTML) {
        const titleText = field;
        const titleEl = legend.querySelector('.legend-title');
        if (titleEl) titleEl.innerText = titleText;
    }
    alert('Legend title updated');
}

// feature selector removed - editing is done by clicking the feature on the map

function editSelectedFeature() {
    if (!selectedLayer) {
        alert('Select a feature first to edit it.');
        return;
    }
    if (selectedLayer.editing && typeof selectedLayer.editing.enable === 'function') {
        selectedLayer.editing.enable();
        alert('Selected feature is now editable. Drag vertices to adjust it.');
        return;
    }
    if (drawControl && drawControl._toolbars && drawControl._toolbars.edit) {
        const editMode = drawControl._toolbars.edit._modes.edit;
        if (editMode && editMode.handler) {
            editMode.handler.enable();
            alert('Edit mode enabled. Select and drag the feature vertices.');
            return;
        }
    }
    alert('Unable to activate edit mode for the selected feature.');
}

function enableVertexEditing() {
    if (!currentLayer) {
        alert('Load a shapefile first to enable vertex editing.');
        return;
    }

    forEachFeatureLayer(layer => editableFeatures.addLayer(layer));

    if (drawControl && drawControl._toolbars && drawControl._toolbars.edit) {
        const editMode = drawControl._toolbars.edit._modes.edit;
        if (editMode && editMode.handler) {
            editMode.handler.enable();
        }
    }

    alert('Vertex editing enabled. Use the edit toolbar to adjust vertices.');
}

async function exportPNG() {
    const exportArea = document.getElementById('pageLayout');
    if (!exportArea) return;

    try {
        const canvas = await html2canvas(exportArea, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true
        });
        
        const link = document.createElement('a');
        link.download = 'map-with-legend.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        alert('PNG export failed: ' + error.message);
    }
}

async function exportCleanPNG() {
    const exportArea = document.getElementById('pageLayout');
    const search = document.getElementById('mapSearchContainer');
    if (!exportArea) return;

    if (search) search.style.display = 'none';
    try {
        const canvas = await html2canvas(exportArea, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true
        });
        
        const link = document.createElement('a');
        link.download = 'clean-map.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        alert('Clean PNG export failed: ' + error.message);
    } finally {
        if (search) search.style.display = 'flex';
    }
}

async function exportCleanPDF() {
    const exportArea = document.getElementById('pageLayout');
    const search = document.getElementById('mapSearchContainer');
    if (!exportArea) return;

    if (search) search.style.display = 'none';
    try {
        const canvas = await html2canvas(exportArea, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true
        });
        
        const dataUrl = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
        pdf.addImage(dataUrl, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save('clean-map.pdf');
    } catch (error) {
        alert('Clean PDF export failed: ' + error.message);
    } finally {
        if (search) search.style.display = 'flex';
    }
}

async function exportPDFMap() {
    const mapExportArea = document.getElementById('mapExportArea');
    const sidebar = document.getElementById('sidebar');
    
    if (!mapExportArea) {
        alert('Map export area not found');
        return;
    }

    // Hide sidebar for clean export
    if (sidebar) sidebar.style.display = 'none';

    try {
        // Wait for map to settle
        await new Promise(resolve => setTimeout(resolve, 300));

        // Trigger map resize to ensure proper rendering
        if (map && map.invalidateSize) {
            map.invalidateSize();
        }

        // Wait for map tiles to render
        await new Promise(resolve => setTimeout(resolve, 500));

        // Capture the entire map export area with high quality
        const canvas = await html2canvas(mapExportArea, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: true,
            imageTimeout: 10000,
            canvasWidth: mapExportArea.offsetWidth,
            canvasHeight: mapExportArea.offsetHeight
        });

        // Convert to PDF on A4 format
        const { jsPDF } = window.jspdf;
        const imgData = canvas.toDataURL('image/png');
        
        // Determine orientation based on dimensions
        const isLandscape = canvas.width > canvas.height;
        const pdf = new jsPDF({
            orientation: isLandscape ? 'landscape' : 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        // Calculate dimensions to fit the image on the page while maintaining aspect ratio
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - margin * 2;

        const imgRatio = canvas.width / canvas.height;
        let imgWidth = maxWidth;
        let imgHeight = maxWidth / imgRatio;

        if (imgHeight > maxHeight) {
            imgHeight = maxHeight;
            imgWidth = maxHeight * imgRatio;
        }

        // Center the image on the page
        const x = (pageWidth - imgWidth) / 2;
        const y = (pageHeight - imgHeight) / 2;

        pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
        pdf.save('map-export.pdf');
        
        alert('Map exported to PDF successfully!');
    } catch (error) {
        console.error('PDF export error:', error);
        alert('PDF export failed: ' + (error.message || error));
    } finally {
        // Restore sidebar
        if (sidebar) sidebar.style.display = '';
        
        // Trigger map resize again
        if (map && map.invalidateSize) {
            map.invalidateSize();
        }
    }
}

function printCleanMap() {
    const sidebar = document.getElementById('sidebar');
    const search = document.getElementById('mapSearchContainer');
    // Save current map view
    const currentCenter = map ? map.getCenter() : null;
    const currentZoom = map ? map.getZoom() : null;

    if (sidebar) sidebar.style.display = 'none';
    if (search) search.style.display = 'none';

    // Delay slightly to allow DOM changes to settle before printing
    setTimeout(() => {
        window.print();

        window.onafterprint = function() {
            // Restore UI
            if (sidebar) sidebar.style.display = '';
            if (search) search.style.display = 'flex';

            // Restore map view and resize map to re-render tiles
            if (map) {
                try {
                    map.invalidateSize();
                    if (currentCenter && currentZoom != null) {
                        map.setView(currentCenter, currentZoom);
                    }
                } catch (e) {
                    console.warn('Error restoring map view after print', e);
                }
            }

            window.onafterprint = null;
        };
    }, 200);
}

async function exportPDF() {
    const exportArea = document.getElementById('mapExportArea');
    if (!exportArea) return;

    try {
        const dataUrl = await domtoimage.toPng(exportArea, {
            quality: 1,
            bgcolor: '#ffffff',
            cacheBust: true,
            style: {
                transform: 'scale(1)'
            }
        });

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [exportArea.offsetWidth, exportArea.offsetHeight] });
        pdf.addImage(dataUrl, 'PNG', 0, 0, exportArea.offsetWidth, exportArea.offsetHeight);
        pdf.save('map-with-legend.pdf');
    } catch (error) {
        alert('PDF export failed: ' + error.message);
    }
}

async function exportMap() {
    const fmt = document.getElementById('exportFormat')?.value || 'png';
    if (fmt !== 'png' && fmt !== 'pdf') {
        alert('Invalid export format selected.');
        return;
    }
    
    const exportArea = document.getElementById('pageLayout');
    const sidebar = document.getElementById('sidebar');
    const search = document.getElementById('mapSearchContainer');

    if (!exportArea) {
        alert('Export area not found');
        return;
    }

    // Hide UI elements for clean export
    if (sidebar) sidebar.style.display = 'none';
    if (search) search.style.display = 'none';

    try {
        // Wait a moment for map to settle
        await new Promise(resolve => {
            const timer = window.setTimeout(resolve, 500);
        });

        // Trigger a map resize to ensure proper rendering
        if (map && map.invalidateSize) {
            map.invalidateSize();
        }

        // Wait another moment for resize to complete
        await new Promise(resolve => {
            const timer = window.setTimeout(resolve, 300);
        });

        // Capture the export area with optimized settings
        const canvas = await html2canvas(exportArea, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: true,
            imageTimeout: 10000,
            canvasWidth: exportArea.offsetWidth,
            canvasHeight: exportArea.offsetHeight
        });

        // Auto-detect content bounds and re-center content inside a final canvas
        function getContentBoundingBox(srcCanvas, whiteTolerance = 15) {
            try {
                const w = srcCanvas.width;
                const h = srcCanvas.height;
                const ctx = srcCanvas.getContext('2d');
                const data = ctx.getImageData(0, 0, w, h).data;

                let minX = w, minY = h, maxX = 0, maxY = 0;
                let found = false;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const i = (y * w + x) * 4;
                        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                        if (a > 16) {
                            const diff = Math.abs(255 - r) + Math.abs(255 - g) + Math.abs(255 - b);
                            if (diff > whiteTolerance) {
                                found = true;
                                if (x < minX) minX = x;
                                if (y < minY) minY = y;
                                if (x > maxX) maxX = x;
                                if (y > maxY) maxY = y;
                            }
                        }
                    }
                }
                if (!found) return { x: 0, y: 0, width: w, height: h };
                return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
            } catch (e) {
                // Fallback to full canvas bounds on error
                return { x: 0, y: 0, width: srcCanvas.width, height: srcCanvas.height };
            }
        }

        function createCenteredCanvas(srcCanvas, padding = 0) {
            const final = document.createElement('canvas');
            final.width = srcCanvas.width;
            final.height = srcCanvas.height;
            const fctx = final.getContext('2d');
            // Fill white background to ensure PDF viewers keep background
            fctx.fillStyle = '#ffffff';
            fctx.fillRect(0, 0, final.width, final.height);

            const bounds = getContentBoundingBox(srcCanvas);
            const targetX = Math.round((final.width - bounds.width) / 2) - bounds.x + padding;
            const targetY = Math.round((final.height - bounds.height) / 2) - bounds.y + padding;

            fctx.drawImage(srcCanvas, targetX, targetY);
            return final;
        }

        // Save a canvas into a centered PDF page (A4) with margins in mm
        function saveCanvasAsPdfOnA4(srcCanvas, filename = 'map-export.pdf', marginMm = 10) {
            const { jsPDF } = window.jspdf;
            // A4 size in mm
            const A4 = { w: 210, h: 297 };

            const isLandscape = srcCanvas.width > srcCanvas.height;
            const pageW = isLandscape ? A4.h : A4.w;
            const pageH = isLandscape ? A4.w : A4.h;

            // Available area inside margins
            const availW = pageW - marginMm * 2;
            const availH = pageH - marginMm * 2;

            // Determine image size in mm to fit into available area while preserving aspect
            const imgRatio = srcCanvas.width / srcCanvas.height;
            let imgW = availW, imgH = availW / imgRatio;
            if (imgH > availH) {
                imgH = availH;
                imgW = availH * imgRatio;
            }

            const x = (pageW - imgW) / 2;
            const y = (pageH - imgH) / 2;

            const pdf = new jsPDF({ orientation: isLandscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });

            const dataUrl = srcCanvas.toDataURL('image/png');
            // addImage with explicit dimensions in mm centers the image reliably
            pdf.addImage(dataUrl, 'PNG', x, y, imgW, imgH, undefined, 'FAST');
            pdf.save(filename);
        }

        const centeredCanvas = createCenteredCanvas(canvas, 0);
        const dataUrl = centeredCanvas.toDataURL('image/png');

        if (fmt === 'png') {
            const link = document.createElement('a');
            link.download = 'map-export.png';
            link.href = dataUrl;
            link.click();
            alert('Map exported as PNG successfully!');
        } else {
            // Save centered to standard A4 to avoid viewer margin/fit issues
            saveCanvasAsPdfOnA4(centeredCanvas, 'map-export.pdf', 10);
            alert('Map exported as PDF successfully!');
        }
    } catch (error) {
        console.error('Export error:', error);
        alert('Export failed.\n\nError: ' + (error && error.message ? error.message : error));
    } finally {
        // Restore UI
        if (sidebar) sidebar.style.display = '';
        if (search) search.style.display = 'flex';
        
        // Trigger map resize again
        if (map && map.invalidateSize) {
            map.invalidateSize();
        }
    }
}

async function saveEdits() {
    const geojson = getCurrentLayerGeoJSON();
    if (!geojson || !geojson.features || geojson.features.length === 0) {
        alert('No editable features found to save.');
        return;
    }

    saveGeoJSONToStorage([{ name: 'Saved Map', geojson }]);

    try {
        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
        // Try File System Access API first (user may overwrite original file)
        if (window.showSaveFilePicker && lastUploadedFileName) {
            try {
                const opts = {
                    suggestedName: lastUploadedFileName,
                    types: [{
                        description: 'GeoJSON',
                        accept: { 'application/geo+json': ['.geojson'], 'application/json': ['.json'] }
                    }]
                };
                const handle = await window.showSaveFilePicker(opts);
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                alert('Edits saved to: ' + (handle.name || lastUploadedFileName));
                return;
            } catch (err) {
                console.warn('Save via File System Access API failed, falling back to download', err);
                // fall through to fallback download
            }
        }

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = lastUploadedFileName ? (`edited-${lastUploadedFileName.replace(/\.[^/.]+$/, '')}.geojson`) : 'edited-data.geojson';
        link.click();
    } catch (e) {
        console.warn('Could not trigger download:', e);
    }
    alert('Edits saved to localStorage and downloaded (or saved to chosen file).');
}

function togglePopupSettings() {
    const toggle = document.getElementById('popupToggle');
    const panel = document.getElementById('popupSettingsPanel');
    if (!panel || !toggle) return;

    const isCollapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed', !isCollapsed);
    panel.classList.toggle('expanded', isCollapsed);
    toggle.innerText = isCollapsed ? 'Popup Settings ▾' : 'Popup Settings ▸';
}

// Rebind popups for all features with current settings
function applyPopupSettings() {
    if (!currentLayer) {
        showNotification('Please load a data layer first before configuring popup settings.', 'info', 'No Layer Loaded');
        return;
    }

    forEachFeatureLayer(layer => {
        layer._popupBound = false;
        bindPopupForLayer(layer, layer.feature);
    });

    showNotification('Popup settings have been applied to all features.', 'success', 'Settings Applied');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderAttributeEditor(feature, showEditor = false) {
    const editor = document.getElementById('attributeEditor');
    if (!editor) return;
    if (!showEditor || !feature) {
        editor.innerHTML = feature ? '<div style="color:#d1d5db;font-size:13px;">Feature selected. Edit attributes below.</div>' : '<div style="color:#d1d1db;font-size:13px;"></div>';
        const panel = document.getElementById('featureEditPanel');
        if (panel) panel.classList.add('hidden');
        const origParent = window._attributeEditorOriginalParent;
        const next = window._attributeEditorNextSibling;
        if (editor && origParent && origParent !== editor.parentNode) {
            if (next) origParent.insertBefore(editor, next);
            else origParent.appendChild(editor);
        }
        return;
    }
    const props = feature.properties || {};
    const rows = Object.keys(props).map(key => {
        const raw = props[key];
        if (raw === null || raw === undefined) {
            return `
            <div style="margin-bottom:12px;">
                <label style="display:block;font-weight:600;margin-bottom:4px;color:#e2e8f0;">${escapeHtml(key)}</label>
                <input data-prop="${escapeHtml(key)}" class="attribute-field" type="text" value="" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#f8fafc;" />
            </div>`;
        }
        if (typeof raw === 'object') {
            const value = JSON.stringify(raw, null, 2);
            return `
            <div style="margin-bottom:12px;">
                <label style="display:block;font-weight:600;margin-bottom:4px;color:#e2e8f0;">${escapeHtml(key)}</label>
                <textarea data-prop="${escapeHtml(key)}" class="attribute-json" style="width:100%;height:80px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.04);color:#f8fafc;">${escapeHtml(value)}</textarea>
            </div>`;
        }
        const value = raw;
        const type = typeof raw === 'number' ? 'number' : 'text';
        return `
            <div style="margin-bottom:12px;">
                <label style="display:block;font-weight:600;margin-bottom:4px;color:#e2e8f0;">${escapeHtml(key)}</label>
                <input data-prop="${escapeHtml(key)}" class="attribute-field" type="${type}" value="${escapeHtml(value)}" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#f8fafc;" />
            </div>`;
    }).join('');

    const addAttributeForm = feature ? `
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.18);">
            <div style="font-weight:600;margin-bottom:8px;color:#f8fafc;"></div>
            <input id="newAttrKey" placeholder="Property key" style="width:92%;max-width:260px;margin-bottom:8px;padding:4px 6px;border-radius:4px;border:0.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.08);color:#f8fafc;font-size:12px;" />
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <select id="newAttrType" style="width:40%;padding:4px 6px;border-radius:4px;background:rgba(56, 53, 53, 0.9);color:#f8fafc;border:0.5px solid rgba(255,255,255,0.12);font-size:12px;">
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="json">JSON Object</option>
                </select>
                <input id="newAttrValue" placeholder="Property value" style="flex:1;max-width:260px;padding:4px 6px;border-radius:4px;border:0.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.08);color:#f8fafc;font-size:12px;" />
            </div>
            <textarea id="newAttrValueJson" placeholder='Paste JSON object here (e.g. {"land":true})' style="display:none;width:92%;max-width:260px;height:90px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.04);color:#f8fafc;margin-bottom:8px;"></textarea>
            <button id="addAttributeBtn" style="width:60%;max-width:300px;padding:5px;border-radius:8px;border:none;background:#2563eb;color:white;cursor:pointer; margin-top:10px; font-size:14px">Add Attribute</button>
        </div>
    ` : '';

    editor.innerHTML = feature ? `
        <div style="font-weight:700;margin-bottom:10px;color:#f8fafc;">Add Attribute</div>
        ${rows}
        <div style="font-size:10px;color:#cbd5e1;"></div>
        ${addAttributeForm}
    ` : '<div style="color:#d1d5db;font-size:13px;">Click a feature on the map to select it and edit its attributes below.</div>';

    if (!feature) return;

    // Move the attribute editor element into the right-side panel so inputs keep their listeners
    const panel = document.getElementById('featureEditPanel');
    const panelContent = document.getElementById('featureEditPanelContent');
    if (panel && panelContent) {
        // store original parent for restore
        if (!window._attributeEditorOriginalParent) {
            window._attributeEditorOriginalParent = editor.parentNode;
            window._attributeEditorNextSibling = editor.nextSibling;
        }
        // append editor into the panel content
        panelContent.appendChild(editor);
        panel.classList.remove('hidden');
    }

    // handle simple inputs (text/number)
    editor.querySelectorAll('.attribute-field').forEach(input => {
        input.addEventListener('change', event => {
            const key = event.target.dataset.prop;
            let value = event.target.value;
            const originalValue = feature.properties[key];
            if (typeof originalValue === 'number') {
                const parsed = parseFloat(value);
                value = Number.isNaN(parsed) ? value : parsed;
            }
            feature.properties[key] = value;
            if (selectedLayer) bindPopupForLayer(selectedLayer, feature);
            updateSelectionInfo(feature);
        });
    });

    // handle JSON textareas
    editor.querySelectorAll('.attribute-json').forEach(area => {
        area.addEventListener('change', event => {
            const key = event.target.dataset.prop;
            const txt = event.target.value;
            try {
                const parsed = JSON.parse(txt);
                feature.properties[key] = parsed;
            } catch (err) {
                alert('Invalid JSON for property ' + key + ': ' + err.message);
                return;
            }
            if (selectedLayer) bindPopupForLayer(selectedLayer, feature);
            updateSelectionInfo(feature);
        });
    });

    // add attribute handler and type toggle
    const addBtn = document.getElementById('addAttributeBtn');
    if (addBtn) {
        const typeSel = document.getElementById('newAttrType');
        const textInput = document.getElementById('newAttrValue');
        const jsonArea = document.getElementById('newAttrValueJson');

        if (typeSel && textInput && jsonArea) {
            typeSel.addEventListener('change', () => {
                if (typeSel.value === 'json') {
                    textInput.style.display = 'none';
                    jsonArea.style.display = 'block';
                } else {
                    textInput.style.display = 'block';
                    jsonArea.style.display = 'none';
                }
            });
        }

        addBtn.addEventListener('click', () => {
            const keyInput = document.getElementById('newAttrKey');
            if (!keyInput) return;

            const key = keyInput.value.trim();
            if (!key) {
                alert('Enter an attribute key first.');
                return;
            }

            let value = null;
            const t = document.getElementById('newAttrType')?.value || 'text';
            if (t === 'json') {
                const txt = document.getElementById('newAttrValueJson')?.value || '';
                try {
                    value = JSON.parse(txt);
                } catch (err) {
                    alert('Invalid JSON: ' + err.message);
                    return;
                }
            } else if (t === 'number') {
                const raw = document.getElementById('newAttrValue')?.value || '';
                const parsed = parseFloat(raw);
                value = Number.isNaN(parsed) ? raw : parsed;
            } else {
                value = document.getElementById('newAttrValue')?.value || '';
            }

            feature.properties[key] = value;
            // reset inputs
            if (keyInput) keyInput.value = '';
            if (textInput) textInput.value = '';
            if (jsonArea) jsonArea.value = '';

            renderAttributeEditor(feature, true);
            if (selectedLayer) bindPopupForLayer(selectedLayer, feature);
            updateSelectionInfo(feature, true);
        });
    }
}

function disableAllEditing() {
    forEachFeatureLayer(layer => {
        if (layer.editing && typeof layer.editing.disable === 'function') {
            try {
                layer.editing.disable();
            } catch (err) {
                // ignore unsupported layer editing state
            }
        }
    });
    if (drawControl && drawControl._toolbars && drawControl._toolbars.edit) {
        const editMode = drawControl._toolbars.edit._modes.edit;
        if (editMode && editMode.handler && typeof editMode.handler.disable === 'function') {
            try {
                editMode.handler.disable();
            } catch (err) {
                // ignore if handler is already disabled
            }
        }
    }
}

function enableFeatureEditing(layer) {
    if (!layer) return;

    if (!editableFeatures.hasLayer(layer)) {
        editableFeatures.addLayer(layer);
    }

    if (layer.editing && typeof layer.editing.enable === 'function') {
        try {
            layer.editing.enable();
            return;
        } catch (err) {
            // fallback to drawControl edit handler
        }
    }

    if (drawControl && drawControl._toolbars && drawControl._toolbars.edit) {
        const editMode = drawControl._toolbars.edit._modes.edit;
        if (editMode && editMode.handler && typeof editMode.handler.enable === 'function') {
            try {
                if (editMode.handler._featureGroup && !editMode.handler._featureGroup.hasLayer(layer)) {
                    editMode.handler._featureGroup.addLayer(layer);
                }
                editMode.handler.enable();
            } catch (err) {
                // ignore edit activation failure
            }
        }
    }
}

function updateSelectionInfo(feature, showEditor = true) {
    const info = document.getElementById('selectionInfo');
    if (!info) return;
    if (!feature) {
        info.innerHTML = 'No feature selected.';
        renderAttributeEditor(null, false);
        updateStyleControls(null);
        return;
    }
    const props = feature.properties || {};
    const idField = Object.keys(props)[0] || 'Selected feature';
    info.innerHTML = `Selected: <strong>${escapeHtml(String(props[idField] ?? idField))}</strong><br><span style="font-size:12px;color:#cbd5db;">Click the map feature to open its popup and edit attributes below.</span>`;
    renderAttributeEditor(feature, showEditor);
    updateStyleControls(selectedLayer);
}

function updateStyleControls(layer) {
    const stroke = document.getElementById('styleStrokeColor');
    const fill = document.getElementById('styleFillColor');
    if (!stroke || !fill) return;
    if (!layer) {
        stroke.value = '#ff6f00';
        fill.value = '#b91c1c';
        return;
    }
    const style = layer._originalStyle || {};
    stroke.value = style.color || layer.options?.color || '#ff6f00';
    fill.value = style.fillColor || layer.options?.fillColor || '#b91c1c';
}

function applyStyleToSelectedFeature() {
    if (!selectedLayer || !selectedLayer.setStyle) {
        alert('Select a feature first.');
        return;
    }
    const stroke = document.getElementById('styleStrokeColor')?.value;
    const fill = document.getElementById('styleFillColor')?.value;
    const style = {
        color: stroke || '#ff6f00',
        weight: 3,
        opacity: 1
    };
    if (selectedLayer.feature?.geometry?.type !== 'LineString') {
        style.fillColor = fill || stroke || '#b91c1c';
        style.fillOpacity = 0.6;
    }
    saveLayerOriginalStyle(selectedLayer);
    selectedLayer.setStyle(style);
    selectedLayer._originalStyle = selectedLayer._originalStyle || {};
    selectedLayer._originalStyle.color = style.color;
    if (style.fillColor) selectedLayer._originalStyle.fillColor = style.fillColor;
    selectedLayer._originalStyle.fillOpacity = style.fillOpacity != null ? style.fillOpacity : selectedLayer._originalStyle.fillOpacity;
    updateStyleControls(selectedLayer);
}

function resetSelection() {
    selectedLayer = null;
    selectedFeature = null;
    selectedFeatures = [];
    const info = document.getElementById('selectionInfo');
    if (info) info.innerHTML = 'No feature selected.';
    renderAttributeEditor(null);
    // hide right-side edit panel if present
    const panel = document.getElementById('featureEditPanel');
    if (panel) {
        panel.classList.add('hidden');
        // restore editor to original location if it was moved
        const editor = document.getElementById('attributeEditor');
        const origParent = window._attributeEditorOriginalParent;
        const next = window._attributeEditorNextSibling;
        if (editor && origParent && origParent !== editor.parentNode) {
            if (next) origParent.insertBefore(editor, next);
            else origParent.appendChild(editor);
        }
    }
}

// ============================
// FILTER LAYER
// ============================

function filterLayer() {

    const field = document.getElementById('filterField').value;
    const value = document.getElementById('filterValue').value;

    forEachFeatureLayer(layer => {
        const props = layer.feature.properties;

        if (props[field] == value) {
            layer.setStyle({
                opacity: 1,
                fillOpacity: 0.9
            });
        } else {
            layer.setStyle({
                opacity: 0.1,
                fillOpacity: 0.1
            });
        }
    });

}

// ============================
// BUFFER ANALYSIS
// ============================

function createBuffer() {
    const distance = parseFloat(
        document.getElementById('bufferDistance').value
    );

    if (!currentLayer) {
        alert('Load a layer first.');
        return;
    }

    if (!selectedFeature) {
        alert('Select a feature first, then click Buffer.');
        return;
    }

    if (isNaN(distance) || distance <= 0) {
        alert('Enter a valid buffer distance in meters.');
        return;
    }

    const buffered = turf.buffer(
        selectedFeature,
        distance,
        { units: 'meters' }
    );

    L.geoJSON(buffered, {
        style: {
            color: 'orange',
            fillOpacity: 0.2
        }
    }).addTo(map);
}

// ============================
// MERGE FEATURES
// ============================

function mergeSelected() {

    if (selectedFeatures.length < 2) {
        alert("Select at least 2 features");
        return;
    }

    let merged = selectedFeatures[0];

    for (let i = 1; i < selectedFeatures.length; i++) {

        merged = turf.union(merged, selectedFeatures[i]);

    }

    L.geoJSON(merged, {
        style: {
            color: 'purple'
        }
    }).addTo(map);

}

// ============================
// EXPORT EXCEL
// ============================

function exportExcel() {

    let data = [];

    forEachFeatureLayer(layer => {
        data.push(layer.feature.properties);
    });

    const worksheet = XLSX.utils.json_to_sheet(data);

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "GIS Data");

    XLSX.writeFile(workbook, "gis_data.xlsx");

}

// ============================
// EXPORT GEOJSON
// ============================

function exportGeoJSON() {

    const data = getCurrentLayerGeoJSON();

    const blob = new Blob(
        [JSON.stringify(data)],
        { type: "application/json" }
    );

    const link = document.createElement('a');

    link.href = URL.createObjectURL(blob);

    link.download = "data.geojson";

    link.click();

}

// ============================
// SHOW COORDINATES
// ============================

map.on('click', function(e) {
    // Show coordinates
    document.getElementById('coordinates').innerHTML =
        `
        Latitude: ${e.latlng.lat.toFixed(5)} &nbsp;  
        Longitude: ${e.latlng.lng.toFixed(5)}
        `;
    
    // Deselect feature when clicking on empty map area
    if (selectedLayer) {
        try {
            if (typeof selectedLayer.closePopup === 'function') {
                selectedLayer.closePopup();
            }
        } catch (err) {
            console.warn('Error closing popup on deselect:', err);
        }
        restoreLayerStyle(selectedLayer);
        selectedLayer = null;
        selectedFeature = null;
        selectedFeatures = [];
        updateSelectionInfo(null);
    }
});

map.on(L.Draw.Event.CREATED, function (e) {
    const layer = e.layer;
    if (!layer) return;

    if (!layer.feature) {
        layer.feature = {
            type: 'Feature',
            properties: {}
        };
    }
    layer.feature.properties = layer.feature.properties || {};

    editableFeatures.addLayer(layer);
    drawnItems.addLayer(layer);
    currentLayer.addLayer(layer);

    // Register feature so it appears in the feature selector and can be edited
    try {
        // register internal id for the drawn feature (no select dropdown)
        const featureId = `drawn-feature-${Date.now()}-${Math.floor(Math.random()*10000)}`;
        layer._featureId = featureId;
        featureLayerMap[featureId] = layer;
    } catch (err) {
        // ignore registration errors
    }

    layer.on('click', function (event) {
        event.stopPropagation();
        selectFeatureLayer(layer);
        enableFeatureEditing(layer);
        layer.openPopup();
    });

    selectFeatureLayer(layer, true);
    enableFeatureEditing(layer);

    // Open attribute editor for immediate property entry
    try {
        updateSelectionInfo(layer.feature, true);
        setTimeout(() => {
            const newKey = document.getElementById('newAttrKey');
            if (newKey) newKey.focus();
        }, 250);
    } catch (err) {
        // ignore
    }

    const geojson = layer.toGeoJSON();
    if (geojson.geometry) {
        if (geojson.geometry.type === 'Polygon' || geojson.geometry.type === 'MultiPolygon') {
            const areaSqKm = turf.area(geojson) / 1000000;
            showNotification(`Polygon created. Area: ${areaSqKm.toFixed(4)} sq km`, 'success', 'Polygon Created');
        }
        if (geojson.geometry.type === 'LineString') {
            const length = turf.length(geojson, { units: 'kilometers' });
            showNotification(`Line created. Length: ${length.toFixed(2)} km`, 'success', 'Line Created');
        }
    }
});

// ============================
// BASEMAP SWITCHER
// ============================

function changeBasemap() {

    map.eachLayer(layer => {

        if (layer instanceof L.TileLayer) {
            map.removeLayer(layer);
        }

    });

    const value =
        document.getElementById('basemapSelector').value;

    if (value === 'osm') {
        osm.addTo(map);
    }

    if (value === 'satellite') {
        satellite.addTo(map);
    }

    if (value === 'topo') {
        topo.addTo(map);
    }

    if (value === 'none') {
        // No basemap - blank background
    }

}

async function exportLayoutPDF() {
    const layout = document.getElementById('pageLayout');
    if (!layout) {
        alert('Layout not found');
        return;
    }

    // Hide UI not part of layout
    const sidebar = document.getElementById('sidebar');
    const search = document.getElementById('mapSearchContainer');
    const bottomActions = document.getElementById('bottomActions');
    if (sidebar) sidebar.style.display = 'none';
    if (search) search.style.display = 'none';
    if (bottomActions) bottomActions.style.display = 'none';
    
    // declare center/zoom at function scope so finally can restore
    let currentCenter = null;
    let currentZoom = null;

    try {
        // Ensure map is properly resized and centered inside the layout before capture
        currentCenter = map ? map.getCenter() : null;
        currentZoom = map ? map.getZoom() : null;
        if (map && map.invalidateSize) {
            try {
                map.invalidateSize();
                // Try to set view to current center/zoom to force re-render
                if (currentCenter && currentZoom != null) {
                    map.setView(currentCenter, currentZoom, { animate: false });
                }
            } catch (e) {
                console.warn('Error forcing map resize before export', e);
            }
        }

        // Update overview map with current layers before exporting
        try {
            updateOverviewMap();
            if (overviewMap && overviewMap.invalidateSize) {
                overviewMap.invalidateSize();
            }
        } catch (e) {
            console.warn('Error updating overview map before export', e);
        }

        // Wait for the map to finish moving/tiles to render
        await new Promise(resolve => {
            let resolved = false;
            const done = () => { if (!resolved) { resolved = true; resolve(); } };
            try {
                map.once('moveend', done);
            } catch (e) {
                // ignore
            }
            // Fallback timeout
            setTimeout(done, 1000);
        });

        // Render layout to canvas at higher scale for quality
        const canvas = await html2canvas(layout, { 
            backgroundColor: '#ffffff', 
            scale: 2, 
            useCORS: true,
            allowTaint: true,
            width: layout.offsetWidth,
            height: layout.offsetHeight
        });

        // Compose a final canvas sized to A4 landscape at a chosen px/mm scale
        const { jsPDF } = window.jspdf;
        const pageWidth = 297; // mm
        const pageHeight = 210; // mm
        const margin = 10; // mm

        // pixels per mm - choose 4 for decent resolution (approx 4px/mm => ~288 DPI)
        const pxPerMm = 4;
        const targetPxW = Math.round(pageWidth * pxPerMm);
        const targetPxH = Math.round(pageHeight * pxPerMm);

        const availablePxW = Math.round((pageWidth - margin * 2) * pxPerMm);
        const availablePxH = Math.round((pageHeight - margin * 2) * pxPerMm);

        // create final canvas
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = targetPxW;
        finalCanvas.height = targetPxH;
        const ctx = finalCanvas.getContext('2d');
        // white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetPxW, targetPxH);

        // determine scale to fit the captured canvas into available area
        // Prefer vertical centering - use smaller scale to keep aspect ratio
        const scale = Math.min(availablePxW / canvas.width, availablePxH / canvas.height);
        const destW = Math.round(canvas.width * scale);
        const destH = Math.round(canvas.height * scale);
        
        // Center horizontally and vertically with proper margins
        const marginPx = Math.round(margin * pxPerMm);
        const destX = Math.round((targetPxW - destW) / 2);
        const destY = marginPx + Math.round((availablePxH - destH) / 2);

        // draw the captured layout into the final centered canvas
        ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, destX, destY, destW, destH);

        // Instead of saving immediately, open an interactive preview allowing nudges
        showPdfPreview(finalCanvas, pageWidth, pageHeight, margin);
    } catch (err) {
        console.error(err);
        alert('PDF export failed: ' + (err && err.message ? err.message : err));
    } finally {
        if (sidebar) sidebar.style.display = '';
        if (search) search.style.display = 'flex';
        if (bottomActions) bottomActions.style.display = '';
        if (map && map.invalidateSize) {
            try {
                map.invalidateSize();
                if (currentCenter && currentZoom != null) {
                    map.setView(currentCenter, currentZoom, { animate: false });
                }
            } catch (e) {
                console.warn('Error restoring map after export', e);
            }
        }
    }
}

// --- PDF preview and nudge helpers ---
function ensurePdfPreviewModal() {
    if (document.getElementById('pdfPreviewModal')) return;

    const modal = document.createElement('div');
    modal.id = 'pdfPreviewModal';

    modal.innerHTML = `
        <div id="pdfPreviewContent">
            <canvas id="pdfPreviewCanvas"></canvas>
            <div class="pdfPreviewControls">
                <div>Offset X: <button id="nudgeLeft">◀</button> <button id="nudgeRight">▶</button></div>
                <div>Offset Y: <button id="nudgeUp">▲</button> <button id="nudgeDown">▼</button></div>
                <div style="flex:1"></div>
                <button id="savePdfBtn" class="primary">Save PDF</button>
                <button id="closePdfBtn">Cancel</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // handlers
    modal.querySelector('#closePdfBtn').addEventListener('click', () => { modal.style.display = 'none'; });
}

function showPdfPreview(sourceCanvas, pageWidth, pageHeight, marginMm) {
    ensurePdfPreviewModal();
    const modal = document.getElementById('pdfPreviewModal');
    const preview = document.getElementById('pdfPreviewCanvas');
    const pxPerMm = 4;
    const targetW = Math.round(pageWidth * pxPerMm);
    const targetH = Math.round(pageHeight * pxPerMm);

    preview.width = targetW;
    preview.height = targetH;
    const ctx = preview.getContext('2d');

    // initial placement centers the image
    const availableW = Math.round((pageWidth - marginMm * 2) * pxPerMm);
    const availableH = Math.round((pageHeight - marginMm * 2) * pxPerMm);
    const scale = Math.min(availableW / sourceCanvas.width, availableH / sourceCanvas.height, 1);
    const destW = Math.round(sourceCanvas.width * scale);
    const destH = Math.round(sourceCanvas.height * scale);
    let offsetX = Math.round((targetW - destW) / 2);
    let offsetY = Math.round((targetH - destH) / 2);

    function render() {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, offsetX, offsetY, destW, destH);
    }

    render();
    modal.style.display = 'flex';

    document.getElementById('nudgeLeft').onclick = () => { offsetX -= 2; render(); };
    document.getElementById('nudgeRight').onclick = () => { offsetX += 2; render(); };
    document.getElementById('nudgeUp').onclick = () => { offsetY -= 2; render(); };
    document.getElementById('nudgeDown').onclick = () => { offsetY += 2; render(); };

    document.getElementById('savePdfBtn').onclick = () => {
        // Hide preview UI to guarantee it is not part of the final output
        const controls = modal.querySelector('.pdfPreviewControls');
        if (controls) controls.style.display = 'none';
        // hide the modal overlay while we build the final canvas
        modal.style.display = 'none';

        // create a canvas matching the preview pixel size and draw the preview placement
        const toSave = document.createElement('canvas');
        toSave.width = preview.width;
        toSave.height = preview.height;
        const sctx = toSave.getContext('2d');
        sctx.fillStyle = '#ffffff';
        sctx.fillRect(0, 0, toSave.width, toSave.height);
        sctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, offsetX, offsetY, destW, destH);

        // Use A4 centered saver so the final PDF matches the on-screen preview placement
        saveCanvasAsPdfOnA4(toSave, 'map-layout.pdf', marginMm);
    };
}

// Function to save canvas as PDF on A4 page
function saveCanvasAsPdfOnA4(srcCanvas, filename = 'map-export.pdf', marginMm = 10) {
    const { jsPDF } = window.jspdf;
    const pageWidth = 297; // A4 width in mm
    const pageHeight = 210; // A4 height in mm
    
    // Create PDF with A4 landscape orientation
    const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
    });
    
    // Convert canvas to image data
    const imgData = srcCanvas.toDataURL('image/png');
    
    // The srcCanvas is already at A4 size with proper margins, just add it as-is
    // No need to scale - srcCanvas was pre-scaled in the preview
    pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
    
    // Save the PDF
    pdf.save(filename);
}

