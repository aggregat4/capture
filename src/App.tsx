import React, { useState } from 'react';
import './App.css';

const App: React.FC = () => {
    const [wordCount, setWordCount] = useState(0);

    const handleContentChange = (e: React.FormEvent<HTMLDivElement>) => {
        const text = e.currentTarget.textContent || '';
        const words = text.trim().split(/\s+/).filter(word => word.length > 0);
        setWordCount(words.length);
    };

    return (
        <div className="app-container">
            {/* Header/Toolbar */}
            <div className="header">
                <h1>Capture</h1>
            </div>

            {/* Content Editable Area */}
            <div
                className="content-editable"
                contentEditable
                onInput={handleContentChange}
            />

            {/* Status Bar */}
            <div className="status-bar">
                <div className="status-bar-content">
                    Words: {wordCount}
                </div>
            </div>
        </div>
    );
};

export default App; 