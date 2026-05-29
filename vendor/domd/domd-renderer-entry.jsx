import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOMD, DOMDProvider } from './domd.js';
import './domd.css';

const roots = new WeakMap();

function view(markdown) {
    return (
        <DOMDProvider key={markdown} editable={false} initMd={markdown || ''}>
            <DOMD />
        </DOMDProvider>
    );
}

function render(container, markdown) {
    if (!container) return;

    let root = roots.get(container);
    if (!root) {
        root = createRoot(container);
        roots.set(container, root);
    }

    flushSync(() => {
        root.render(view(markdown));
    });
}

function renderToHtml(markdown) {
    return renderToStaticMarkup(view(markdown));
}

window.DOMDMarkdown = { render, renderToHtml };
