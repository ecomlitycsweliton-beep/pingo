// @ts-nocheck

import { GoogleGenAI, Modality } from "https://esm.run/@google/genai";

// --- CONSTANTS ---
// O cliente da IA será inicializado depois que o usuário fornecer uma chave.
let ai;


// --- STATE MANAGEMENT ---
let history = [];
let historyIndex = -1;
let referenceImage = null;
let postReferenceImage = null;
let eraseContext = null;
let isDrawing = false;
let activeBrush = null;
let lassoPath = [];


// DOM Elements Cache
const dom = {
    // Screens
    uploadScreen: document.getElementById('upload-screen'),
    mainContent: document.querySelector('main'),
    proEditorOverlay: document.getElementById('pro-editor-overlay'),
    
    // Upload Screen
    apiKeyInput: document.getElementById('api-key-input'),

    // Pro Editor Elements
    proImage: document.getElementById('pro-image'),
    proCanvas: document.getElementById('pro-canvas'),
    proCanvasContainer: document.querySelector('.pro-image-container'),
    zoomLevelDisplay: document.getElementById('zoom-level-display'),
    proDownloadButton: document.getElementById('pro-download-button'),
    eraseCanvas: document.getElementById('erase-canvas'),
    
    // Tool Specific
    generativeFillPrompt: document.getElementById('generative-fill-prompt'),
    generativeFillButton: document.getElementById('generative-fill-button'),
    addImageReferenceButton: document.getElementById('add-image-reference-button'),
    imageReferenceInput: document.getElementById('image-reference-input'),
    imageReferencePreview: document.getElementById('image-reference-preview'),
    
    // Edit Tool Elements
    activateRemoveBrushButton: document.querySelector('.brush-activate-button[data-context="remove"]'),
    removeObjectControls: document.getElementById('remove-object-controls'),
    applyRemoveObjectButton: document.getElementById('apply-remove-object-button'),
    imperfectionPromptInput: document.getElementById('imperfection-prompt-input'),
    activateCorrectionBrushButton: document.querySelector('.brush-activate-button[data-context="correction"]'),
    correctionControls: document.getElementById('correction-controls'),
    applyCorrectionButton: document.getElementById('apply-correction-button'),


    // Create Tool Elements
    postPromptInput: document.getElementById('post-prompt-input'),
    postExampleButton: document.getElementById('post-example-button'),
    postExampleInput: document.getElementById('post-example-input'),
    postExamplePreview: document.getElementById('post-example-preview'),
    postGenerateButton: document.getElementById('post-generate-button'),
};

// --- CORE FUNCTIONS ---

/**
 * Hides all screens and shows the specified screen.
 * @param {string} screenId The ID of the screen to show ('upload', 'pro').
 */
function showScreen(screenId) {
    dom.mainContent?.classList.add('hidden');
    dom.proEditorOverlay?.classList.add('hidden');
    
    if (screenId === 'upload') {
        dom.mainContent?.classList.remove('hidden');
    } else if (screenId === 'pro') {
        dom.proEditorOverlay?.classList.remove('hidden');
    }
}

/**
 * Pushes a new state to the history stack.
 * @param {object} state The new state to add.
 */
function pushHistory(state) {
    history = history.slice(0, historyIndex + 1);
    history.push(state);
    historyIndex = history.length - 1;
    updateUndoRedoButtons();
}

function applyCurrentState() {
    if (historyIndex < 0 || historyIndex >= history.length) return;

    const state = history[historyIndex];

    if (dom.proImage.src !== state.image.src) {
        dom.proImage.src = state.image.src;
        dom.proImage.onload = () => {
             initializeEditorView(true);
        };
        if (dom.proImage.complete) {
            initializeEditorView(true);
        }
    }

    dom.proCanvas.style.transform = `scale(${state.view.zoom}) rotate(${state.view.rotation}deg)`;
    dom.proImage.style.transform = `translate(-50%, -50%) translate(${state.view.pan.x}px, ${state.view.pan.y}px)`;
    dom.zoomLevelDisplay.textContent = `${Math.round(state.view.zoom * 100)}%`;
    
    const originalAspectRatio = dom.proImage.naturalWidth / dom.proImage.naturalHeight;
    
    if (originalAspectRatio > 0) {
        const container = dom.proCanvas.parentElement;
        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight;
        if (containerWidth > 0 && containerHeight > 0) {
            const containerAspectRatio = containerWidth / containerHeight;
            let canvasWidth, canvasHeight;

            if (originalAspectRatio > containerAspectRatio) {
                canvasWidth = containerWidth;
                canvasHeight = canvasWidth / originalAspectRatio;
            } else {
                canvasHeight = containerHeight;
                canvasWidth = canvasHeight * originalAspectRatio;
            }

            dom.proCanvas.style.width = `${canvasWidth}px`;
            dom.proCanvas.style.height = `${canvasHeight}px`;
        }
    }
}


function updateUndoRedoButtons() {
    const undoButton = document.getElementById('undo-button');
    const redoButton = document.getElementById('redo-button');
    undoButton.disabled = historyIndex <= 0;
    redoButton.disabled = historyIndex >= history.length - 1;
}

function handleUndo() {
    if (historyIndex > 0) {
        historyIndex--;
        applyCurrentState();
        updateUndoRedoButtons();
    }
}

function handleRedo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        applyCurrentState();
        updateUndoRedoButtons();
    }
}

function updateGenerativeFillButtonState() {
    if (!dom.generativeFillButton || !dom.generativeFillPrompt) return;
    const hasText = dom.generativeFillPrompt.value.trim().length > 0;
    const hasImage = !!referenceImage;
    dom.generativeFillButton.disabled = !hasText && !hasImage;
}

function initializeEditorView(isHistoryChange = false) {
    const proImage = dom.proImage;
    const proCanvas = dom.proCanvas;
    
    if (!proImage.naturalWidth) {
        return;
    }
    
    const aspectRatio = proImage.naturalWidth / proImage.naturalHeight;
    proCanvas.style.aspectRatio = String(aspectRatio);

    requestAnimationFrame(() => {
        setupCanvas(proImage, proCanvas);
        
        if (!isHistoryChange) {
             const initialState = {
                image: { src: proImage.src, mimeType: 'image/png' },
                view: { 
                    zoom: 1, 
                    pan: { x: 0, y: 0 }, 
                    rotation: 0,
                },
                creationMethod: 'upload',
            };
            history = [initialState];
            historyIndex = 0;
        }
        
        applyCurrentState();
        updateUndoRedoButtons();
    });
}

function setupCanvas(imageElement, canvasElement) {
    const container = canvasElement.parentElement;
    const containerRect = container.getBoundingClientRect();

    if (containerRect.width === 0 || containerRect.height === 0) {
        return;
    }

    const containerAspectRatio = containerRect.width / containerRect.height;
    const imageAspectRatio = imageElement.naturalWidth / imageElement.naturalHeight;

    let canvasWidth, canvasHeight;

    if (imageAspectRatio > containerAspectRatio) {
        canvasWidth = containerRect.width;
        canvasHeight = canvasWidth / imageAspectRatio;
    } else {
        canvasHeight = containerRect.height;
        canvasWidth = canvasHeight * imageAspectRatio;
    }

    canvasElement.style.width = `${canvasWidth}px`;
    canvasElement.style.height = `${canvasHeight}px`;
}

function renderStateToCanvas(state) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = state.image.src;

        image.onload = () => {
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            ctx.drawImage(image, 0, 0);
            resolve(canvas);
        };
        image.onerror = () => {
            reject(new Error("Não foi possível carregar a imagem de origem para renderização."));
        };
    });
}

function switchTool(toolName) {
    deactivateBrush();
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tool-panel').forEach(panel => panel.classList.remove('active'));

    document.querySelector(`.tool-button[data-tool="${toolName}"]`)?.classList.add('active');
    document.querySelector(`.tool-panel[data-tool="${toolName}"]`)?.classList.add('active');
    
    if (toolName === 'crop') {
        updateGenerativeFillButtonState();
    }
}

async function handleDownload(event) {
    event.preventDefault();
    
    try {
        const state = history[historyIndex];
        const finalCanvas = await renderStateToCanvas(state);
        
        const tempLink = document.createElement('a');
        tempLink.href = finalCanvas.toDataURL(state.image.mimeType || 'image/png');
        tempLink.download = `IAFood-edit-${Date.now()}.png`;

        document.body.appendChild(tempLink);
        tempLink.click();
        document.body.removeChild(tempLink);

    } catch (error) {
        console.error("Erro ao preparar imagem para download:", error);
        alert(`Não foi possível preparar a imagem para download. ${error.message}`);
    }
}


let isPanning = false;
let startPan = { x: 0, y: 0 };

function handleZoom(delta) {
    const state = history[historyIndex];
    let zoom = state.view.zoom;
    zoom += delta;
    zoom = Math.max(0.1, Math.min(zoom, 5));
    
    const currentState = history[historyIndex];
    const pan = zoom <= 1 ? { x: 0, y: 0 } : currentState.view.pan;

    const updatedView = { ...currentState.view, zoom, pan };
    const updatedState = { ...currentState, view: updatedView };
    history[historyIndex] = updatedState;
    
    applyCurrentState();
}

function startPanHandler(e) {
    if (activeBrush || history[historyIndex].view.zoom <= 1) return;
    e.preventDefault();
    isPanning = true;
    dom.proCanvas.classList.add('is-panning');
    const point = e.type === 'touchstart' ? e.touches[0] : e;
    startPan.x = point.clientX - history[historyIndex].view.pan.x;
    startPan.y = point.clientY - history[historyIndex].view.pan.y;
}

function panHandler(e) {
    if (!isPanning) return;
    e.preventDefault();
    const point = e.type === 'touchmove' ? e.touches[0] : e;
    const panX = point.clientX - startPan.x;
    const panY = point.clientY - startPan.y;

    const currentState = history[historyIndex];
    const updatedView = { ...currentState.view, pan: { x: panX, y: panY } };
    const updatedState = { ...currentState, view: updatedView };
    history[historyIndex] = updatedState;
    applyCurrentState();
}

function endPanHandler() {
    isPanning = false;
    dom.proCanvas.classList.remove('is-panning');
}

async function handleGenerativeAction(button, actionFn) {
    if (!ai) {
        alert("O cliente de IA não foi inicializado. Por favor, forneça uma chave de API válida.");
        return;
    }
    const loader = document.getElementById('generative-loader');
    button.disabled = true;
    loader.classList.remove('hidden');

    try {
        await actionFn();
    } catch (err) {
        console.error(`Ação de IA falhou:`, err);
        alert(`Ação de IA falhou. Por favor, tente novamente.\nDetalhes: ${err.message}`);
    } finally {
        loader.classList.add('hidden');
        button.disabled = false;
        applyCurrentState();
    }
}

const handleGenerativeFill = async () => {
    const userPrompt = dom.generativeFillPrompt.value.trim();
    if (!userPrompt && !referenceImage) {
        alert("Por favor, descreva a edição que você gostaria de fazer ou adicione uma imagem de referência.");
        throw new Error("Prompt do usuário e imagem de referência vazios.");
    }

    const state = history[historyIndex];
    const sourceCanvas = await renderStateToCanvas(state);
    const mimeType = state.image.mimeType || 'image/png';
    const sourceBase64 = sourceCanvas.toDataURL(mimeType).split(',')[1];
    const parts = [{ inlineData: { data: sourceBase64, mimeType: mimeType } }];
    let systemPrompt = '';

    if (referenceImage) {
        parts.push({ inlineData: { data: referenceImage.base64, mimeType: referenceImage.mimeType } });
        const userRequestLine = userPrompt ? `Pedido do usuário: "${userPrompt}"` : `Instrução genérica: Use o objeto, estilo ou elemento da SEGUNDA imagem para aprimorar ou adicionar à PRIMEIRA imagem de forma criativa e fotorrealista.`;
        systemPrompt = `Você é um editor de fotos especialista... ${userRequestLine} ...REGRAS IMPORTANTES: Você DEVE retornar APENAS a imagem resultante.`;
    } else {
         systemPrompt = `Você é um editor de fotos profissional. Pedido do usuário: "${userPrompt}" REGRAS IMPORTANTES: 1. Você DEVE retornar APENAS a imagem resultante. 2. NÃO inclua nenhum texto...`;
    }

    parts.push({ text: systemPrompt });
    const config = { responseModalities: [Modality.IMAGE, Modality.TEXT] };
    
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts },
        config,
    });
    
    const imagePart = response.candidates[0].content?.parts?.find(part => part.inlineData);
    if (!imagePart) throw new Error("A IA não retornou uma imagem válida.");

    const aiResult = { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType };
    const finalSrc = `data:${aiResult.mimeType};base64,${aiResult.base64}`;
    
    pushHistory({ 
        ...state, 
        image: { src: finalSrc, mimeType: aiResult.mimeType },
        view: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
        creationMethod: 'ai_edit',
    });
    updateGenerativeFillButtonState();
};

function deactivateBrush() {
    if (!activeBrush) return;
    
    dom.eraseCanvas.classList.add('hidden');
    dom.removeObjectControls?.classList.add('hidden');
    dom.correctionControls?.classList.add('hidden');
    
    dom.eraseCanvas.removeEventListener('mousedown', startDraw);
    window.removeEventListener('mousemove', draw);
    window.removeEventListener('mouseup', stopDraw);
    dom.eraseCanvas.removeEventListener('touchstart', startDraw);
    window.removeEventListener('touchmove', draw);
    window.removeEventListener('touchend', stopDraw);
    
    eraseContext?.clearRect(0, 0, dom.eraseCanvas.width, dom.eraseCanvas.height);
    activeBrush = null;
    lassoPath = [];
    dom.applyRemoveObjectButton.disabled = true;
    dom.applyCorrectionButton.disabled = true;
}

function activateBrush(context) {
    deactivateBrush();
    activeBrush = context;
    
    const proImageRect = dom.proImage.getBoundingClientRect();
    dom.eraseCanvas.width = proImageRect.width;
    dom.eraseCanvas.height = proImageRect.height;
    eraseContext = dom.eraseCanvas.getContext('2d');
    
    dom.eraseCanvas.classList.remove('hidden');
    
    if (context === 'remove') {
        dom.removeObjectControls?.classList.remove('hidden');
        dom.applyRemoveObjectButton.disabled = true;
    } else if (context === 'correction') {
        dom.correctionControls?.classList.remove('hidden');
        dom.applyCorrectionButton.disabled = true;
    }
    
    dom.eraseCanvas.addEventListener('mousedown', startDraw);
    window.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDraw);
    dom.eraseCanvas.addEventListener('touchstart', startDraw, { passive: false });
    window.addEventListener('touchmove', draw, { passive: false });
    window.addEventListener('touchend', stopDraw);
}

function getPoint(e) {
    const rect = dom.eraseCanvas.getBoundingClientRect();
    const point = e.type.startsWith('touch') ? e.touches[0] : e;
    return {
        x: point.clientX - rect.left,
        y: point.clientY - rect.top
    };
}

function startDraw(e) {
    e.preventDefault();
    e.stopPropagation();
    isDrawing = true;
    lassoPath = [];
    eraseContext?.clearRect(0, 0, dom.eraseCanvas.width, dom.eraseCanvas.height);
    const { x, y } = getPoint(e);
    lassoPath.push({x, y});

    eraseContext.beginPath();
    eraseContext.moveTo(x, y);
}

function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    
    const { x, y } = getPoint(e);
    lassoPath.push({x, y});
    
    eraseContext.lineWidth = 2;
    eraseContext.strokeStyle = 'rgba(234, 29, 44, 1)';
    
    eraseContext.lineTo(x, y);
    eraseContext.stroke();
}

function stopDraw() {
    if (!isDrawing) return;
    isDrawing = false;

    if (lassoPath.length < 3) {
        lassoPath = [];
        eraseContext?.clearRect(0, 0, dom.eraseCanvas.width, dom.eraseCanvas.height);
        if (activeBrush === 'remove') dom.applyRemoveObjectButton.disabled = true;
        if (activeBrush === 'correction') dom.applyCorrectionButton.disabled = true;
        return;
    }
    
    eraseContext.closePath();
    eraseContext.fillStyle = 'rgba(234, 29, 44, 0.5)';
    eraseContext.fill();
    
    if (activeBrush === 'remove') {
        dom.applyRemoveObjectButton.disabled = false;
    } else if (activeBrush === 'correction') {
        dom.applyCorrectionButton.disabled = false;
    }
}

async function handleApplyRemoveObject() {
    if (lassoPath.length < 3) {
        return alert("Por favor, desenhe uma seleção completa ao redor do objeto para removê-lo.");
    }
    const state = history[historyIndex];
    const sourceCanvas = await renderStateToCanvas(state);
    const mimeType = state.image.mimeType || 'image/png';
    const sourceBase64 = sourceCanvas.toDataURL(mimeType).split(',')[1];
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = sourceCanvas.width;
    maskCanvas.height = sourceCanvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) throw new Error("Não foi possível criar o contexto da máscara.");
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    const scaleX = sourceCanvas.width / dom.eraseCanvas.width;
    const scaleY = sourceCanvas.height / dom.eraseCanvas.height;
    maskCtx.beginPath();
    maskCtx.moveTo(lassoPath[0].x * scaleX, lassoPath[0].y * scaleY);
    lassoPath.forEach(p => maskCtx.lineTo(p.x * scaleX, p.y * scaleY));
    maskCtx.closePath();
    maskCtx.fillStyle = 'white';
    maskCtx.fill();
    const maskBase64 = maskCanvas.toDataURL('image/png').split(',')[1];
    const parts = [
        { inlineData: { data: sourceBase64, mimeType } },
        { inlineData: { data: maskBase64, mimeType: 'image/png' } },
        { text: "This is an inpainting task. The first image is the source, and the second is a mask. Remove the object indicated by the white area in the mask from the source image and realistically fill the space. Return only the edited image." }
    ];
    const config = { responseModalities: [Modality.IMAGE, Modality.TEXT] };
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash-image-preview', contents: { parts }, config });
    const imagePart = response.candidates[0].content?.parts?.find(part => part.inlineData);
    if (!imagePart) throw new Error("A IA não retornou uma imagem válida.");
    const aiResult = { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType };
    const finalSrc = `data:${aiResult.mimeType};base64,${aiResult.base64}`;
    pushHistory({ ...state, image: { src: finalSrc, mimeType: aiResult.mimeType }, view: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 }, creationMethod: 'ai_edit' });
    deactivateBrush();
}

async function handleImperfectionCorrection() {
    const userPrompt = dom.imperfectionPromptInput.value.trim();
    const hasSelection = lassoPath.length >= 3;
    if (!hasSelection && !userPrompt) {
        return alert("Selecione uma área ou descreva a correção.");
    }
    const state = history[historyIndex];
    const sourceCanvas = await renderStateToCanvas(state);
    const sourceBase64 = sourceCanvas.toDataURL(state.image.mimeType || 'image/png').split(',')[1];
    let systemPrompt = '';
    const parts = [{ inlineData: { data: sourceBase64, mimeType: state.image.mimeType } }];
    if (hasSelection) {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = sourceCanvas.width;
        maskCanvas.height = sourceCanvas.height;
        const maskCtx = maskCanvas.getContext('2d');
        if (!maskCtx) throw new Error("Não foi possível criar o contexto da máscara.");
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        const scaleX = sourceCanvas.width / dom.eraseCanvas.width;
        const scaleY = sourceCanvas.height / dom.eraseCanvas.height;
        maskCtx.beginPath();
        maskCtx.moveTo(lassoPath[0].x * scaleX, lassoPath[0].y * scaleY);
        lassoPath.forEach(p => maskCtx.lineTo(p.x * scaleX, p.y * scaleY));
        maskCtx.closePath();
        maskCtx.fillStyle = 'white';
        maskCtx.fill();
        const maskBase64 = maskCanvas.toDataURL('image/png').split(',')[1];
        parts.push({ inlineData: { data: maskBase64, mimeType: 'image/png' } });
        const userInstruction = userPrompt ? `Instrução do usuário: "${userPrompt}"` : `Instrução: Corrija a imperfeição na área marcada...`;
        systemPrompt = `Você é um retocador de fotos especialista... ${userInstruction} REGRAS: Retorne APENAS a imagem final editada, sem nenhum texto.`;
    } else {
         systemPrompt = `Você é um retocador de fotos especialista... Instrução do usuário: "${userPrompt}" REGRAS: Retorne APENAS a imagem final editada...`;
    }
    parts.push({ text: systemPrompt });
    const config = { responseModalities: [Modality.IMAGE, Modality.TEXT] };
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash-image-preview', contents: { parts }, config });
    const imagePart = response.candidates[0].content?.parts?.find(part => part.inlineData);
    if (!imagePart) throw new Error("A IA não retornou uma imagem válida.");
    const aiResult = { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType };
    const finalSrc = `data:${aiResult.mimeType};base64,${aiResult.base64}`;
    pushHistory({ ...state, image: { src: finalSrc, mimeType: aiResult.mimeType }, view: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 }, creationMethod: 'ai_edit' });
    deactivateBrush();
}

async function handlePostGeneration() {
    const userDescription = dom.postPromptInput.value.trim();
    const state = history[historyIndex];
    const sourceCanvas = await renderStateToCanvas(state);
    const sourceBase64 = sourceCanvas.toDataURL(state.image.mimeType || 'image/png').split(',')[1];
    const productDescriptionLine = userDescription ? `Crie a arte... para o produto: "${userDescription}".` : `Crie a arte... para o produto principal...`;
    let systemPrompt = `${productDescriptionLine} Use manipulação avançada... REGRAS: Você DEVE retornar APENAS a imagem...`.trim();
    const parts = [{ inlineData: { data: sourceBase64, mimeType: state.image.mimeType } }];
    if (postReferenceImage) {
        parts.push({ inlineData: { data: postReferenceImage.base64, mimeType: postReferenceImage.mimeType } });
        systemPrompt = `Você é um diretor de arte publicitário profissional... Se o usuário forneceu uma descrição de texto ("${userDescription}"), use-a... REGRAS: Você DEVE retornar APENAS a imagem...`.trim();
    }
    parts.push({ text: systemPrompt });
    const config = { responseModalities: [Modality.IMAGE, Modality.TEXT] };
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash-image-preview', contents: { parts }, config });
    const imagePart = response.candidates[0].content?.parts?.find(part => part.inlineData);
    if (!imagePart) throw new Error("A IA não retornou uma imagem válida.");
    const aiResult = { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType };
    const finalSrc = `data:${aiResult.mimeType};base64,${aiResult.base64}`;
    pushHistory({ ...state, image: { src: finalSrc, mimeType: aiResult.mimeType }, view: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 }, creationMethod: 'ai_edit' });
}

function initializeAiClient(key) {
    if (key) {
        try {
            ai = new GoogleGenAI({ apiKey: key });
            return true;
        } catch (error) {
            console.error("Falha ao inicializar o GoogleGenAI:", error);
            alert("A chave de API fornecida é inválida. Por favor, verifique e tente novamente.");
            return false;
        }
    }
    return false;
}

function updateBeautifyButtonState() {
    const beautifyButton = document.getElementById('beautify-button');
    const previewImage = document.getElementById('preview-image');
    const apiKey = dom.apiKeyInput.value.trim();
    const hasImage = previewImage.src && !previewImage.classList.contains('hidden') && previewImage.src !== window.location.href;
    beautifyButton.disabled = !(apiKey && hasImage);
}

function setupEventListeners() {
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
    
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const previewImage = document.getElementById('preview-image');
    const beautifyButton = document.getElementById('beautify-button');

    dropZone?.addEventListener('click', () => fileInput.click());
    dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone?.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer?.files.length) {
            fileInput.files = e.dataTransfer.files;
            handleFileSelect({ target: fileInput });
        }
    });
    fileInput.addEventListener('change', handleFileSelect);

    function handleFileSelect(event) {
        const target = event.target;
        const file = target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = e => {
                previewImage.src = e.target?.result;
                previewImage.classList.remove('hidden');
                document.getElementById('upload-instructions')?.classList.add('hidden');
                updateBeautifyButtonState();
            };
            reader.readAsDataURL(file);
        }
    }
    
    beautifyButton.addEventListener('click', () => {
        const apiKey = dom.apiKeyInput.value.trim();
        if (!initializeAiClient(apiKey)) {
            alert("Por favor, insira uma chave de API válida para continuar.");
            return;
        }
        const imageSrc = previewImage.src;
        if (imageSrc) {
            dom.proImage.src = imageSrc;
            dom.proImage.onload = () => {
                showScreen('pro');
                initializeEditorView();
            };
        }
    });
    
    dom.apiKeyInput.addEventListener('input', () => {
        const key = dom.apiKeyInput.value.trim();
        if(key) {
            sessionStorage.setItem('gemini-api-key', key);
        } else {
            sessionStorage.removeItem('gemini-api-key');
        }
        updateBeautifyButtonState();
    });

    document.getElementById('pro-back-button')?.addEventListener('click', () => showScreen('upload'));
    document.getElementById('undo-button')?.addEventListener('click', handleUndo);
    document.getElementById('redo-button')?.addEventListener('click', handleRedo);
    dom.proDownloadButton?.addEventListener('click', (e) => handleDownload(e));

    document.querySelector('.pro-left-toolbar')?.addEventListener('click', (e) => {
        const button = e.target.closest('.tool-button');
        if (button && button.dataset.tool) {
            switchTool(button.dataset.tool);
        }
    });

    document.getElementById('zoom-in-button')?.addEventListener('click', () => handleZoom(0.1));
    document.getElementById('zoom-out-button')?.addEventListener('click', () => handleZoom(-0.1));
    document.getElementById('zoom-reset-button')?.addEventListener('click', () => {
        const currentState = history[historyIndex];
        const updatedView = { ...currentState.view, zoom: 1, pan: { x: 0, y: 0 } };
        const updatedState = { ...currentState, view: updatedView };
        history[historyIndex] = updatedState;
        applyCurrentState();
    });
    dom.proCanvasContainer.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        handleZoom(delta);
    });
    dom.proCanvas.addEventListener('mousedown', startPanHandler);
    window.addEventListener('mousemove', panHandler);
    window.addEventListener('mouseup', endPanHandler);
    dom.proCanvas.addEventListener('touchstart', startPanHandler);
    window.addEventListener('touchmove', panHandler);
    window.addEventListener('touchend', endPanHandler);

    dom.generativeFillButton?.addEventListener('click', () => handleGenerativeAction(dom.generativeFillButton, handleGenerativeFill));
    dom.generativeFillPrompt?.addEventListener('input', updateGenerativeFillButtonState);

    dom.addImageReferenceButton?.addEventListener('click', () => {
        dom.imageReferenceInput?.click();
    });

    dom.imageReferenceInput?.addEventListener('change', (event) => {
        const target = event.target;
        const file = target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = e => {
                const src = e.target?.result;
                const mimeType = file.type;
                const base64 = src.split(',')[1];
                referenceImage = { src, mimeType, base64 };

                const previewImg = dom.imageReferencePreview?.querySelector('img');
                if (previewImg) previewImg.src = src;
                dom.imageReferencePreview?.classList.remove('hidden');
                updateGenerativeFillButtonState();
            };
            reader.readAsDataURL(file);
        }
    });

    dom.imageReferencePreview?.querySelector('.remove-example')?.addEventListener('click', () => {
        referenceImage = null;
        dom.imageReferencePreview?.classList.add('hidden');
        const previewImg = dom.imageReferencePreview?.querySelector('img');
        if (previewImg) previewImg.src = "#";
        dom.imageReferenceInput.value = '';
        updateGenerativeFillButtonState();
    });
    
    dom.activateRemoveBrushButton?.addEventListener('click', () => activateBrush('remove'));
    dom.applyRemoveObjectButton?.addEventListener('click', () => handleGenerativeAction(dom.applyRemoveObjectButton, handleApplyRemoveObject));
    dom.activateCorrectionBrushButton?.addEventListener('click', () => activateBrush('correction'));
    dom.applyCorrectionButton?.addEventListener('click', () => handleGenerativeAction(dom.applyCorrectionButton, handleImperfectionCorrection));

    dom.postGenerateButton?.addEventListener('click', () => handleGenerativeAction(dom.postGenerateButton, handlePostGeneration));
    dom.postExampleButton?.addEventListener('click', () => dom.postExampleInput?.click());
    
    dom.postExampleInput?.addEventListener('change', (event) => {
        const target = event.target;
        const file = target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = e => {
                const src = e.target?.result;
                const mimeType = file.type;
                const base64 = src.split(',')[1];
                postReferenceImage = { src, mimeType, base64 };

                const previewImg = dom.postExamplePreview?.querySelector('img');
                if (previewImg) previewImg.src = src;
                dom.postExamplePreview?.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }
    });

    dom.postExamplePreview?.querySelector('.remove-example')?.addEventListener('click', () => {
        postReferenceImage = null;
        dom.postExamplePreview?.classList.add('hidden');
        const previewImg = dom.postExamplePreview?.querySelector('img');
        if (previewImg) previewImg.src = "#";
        dom.postExampleInput.value = '';
    });
}

function main() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }
    
    const savedApiKey = sessionStorage.getItem('gemini-api-key');
    if (savedApiKey) {
        dom.apiKeyInput.value = savedApiKey;
    }

    setupEventListeners();
    showScreen('upload');
    updateBeautifyButtonState();
}

main();
