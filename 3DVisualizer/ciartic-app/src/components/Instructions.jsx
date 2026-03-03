import React, { useState } from 'react';

const Instructions = ({ onClose }) => {
    const [page, setPage] = useState(0);

    const pages = [
        {
            title: "Welcome to CIARTIC Simulation",
            content: "This is a 3D medical simulation for C-arm guidance. You can use this app to simulate X-ray imaging and positioning."
        },
        {
            title: "Camera & Navigation",
            content: "Use your mouse to look around.\nLeft Click + Drag: Rotate camera\nRight Click + Drag: Pan camera\nScroll Wheel: Zoom in/out"
        },
        {
            title: "C-Arm Controls",
            content: "Use the control panel on the right to adjust the C-arm positioning.\nLift: Adjust height\nColumn Rot: Rotate the main column\nWigWag & Orbital: Angle the detector\nArrows: Move the machine along the floor."
        },
        {
            title: "Taking X-Rays",
            content: "Once the patient is in the beam path, click the orange EXPOSE button on the control panel to capture an image. The live fluoroscopy view will update with the simulated X-ray."
        },
        {
            title: "Keyboard Shortcuts",
            content: "Press P to toggle Patient visibility.\nPress L to toggle skeleton landmarks.\nPress D to toggle the Debug view & floor labels.\nPress C to connect/disconnect the Arduino."
        }
    ];

    const current = pages[page];

    // Neumorphic unified styles - Dark Theme
    const bgDark = '#1e2832';
    const textPrimary = '#e2e8f0';
    const textSecondary = '#a0aec0';

    // Subtle shadows for dark theme
    const shadowOuter = '8px 8px 16px rgba(0, 0, 0, 0.4), -8px -8px 16px rgba(255, 255, 255, 0.03)';
    const shadowInner = 'inset 4px 4px 8px rgba(0, 0, 0, 0.4), inset -4px -4px 8px rgba(255, 255, 255, 0.03)';
    const shadowActive = 'inset 2px 2px 4px rgba(0, 0, 0, 0.5), inset -2px -2px 4px rgba(255, 255, 255, 0.02)';

    const btnStyle = {
        padding: '12px 24px',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.02)', // slight border helps pop in dark mode
        background: bgDark,
        color: textPrimary,
        fontWeight: 'bold',
        fontSize: '15px',
        cursor: 'pointer',
        boxShadow: shadowOuter,
        transition: 'all 0.2s ease-in-out',
        outline: 'none'
    };

    const btnDisabledStyle = {
        ...btnStyle,
        color: '#4a5568',
        boxShadow: shadowInner,
        cursor: 'not-allowed',
        border: 'none',
    };

    const btnPrimaryStyle = {
        ...btnStyle,
        color: '#4a90e2',
    };

    return (
        <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)'
        }}>
            <div style={{
                backgroundColor: bgDark,
                borderRadius: '24px',
                padding: '40px',
                width: '500px',
                maxWidth: '90vw',
                color: textPrimary,
                fontFamily: 'sans-serif',
                boxShadow: shadowOuter,
                border: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#4a90e2', textShadow: '1px 1px 3px rgba(0,0,0,0.5)' }}>
                        {current.title}
                    </h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: bgDark,
                            border: '1px solid rgba(255, 255, 255, 0.02)',
                            color: textSecondary,
                            cursor: 'pointer',
                            fontSize: '18px',
                            fontWeight: 'bold',
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            boxShadow: shadowOuter,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                        }}
                        onMouseDown={e => e.currentTarget.style.boxShadow = shadowActive}
                        onMouseUp={e => e.currentTarget.style.boxShadow = shadowOuter}
                        onMouseLeave={e => e.currentTarget.style.boxShadow = shadowOuter}
                    >
                        ✕
                    </button>
                </div>

                <div style={{
                    fontSize: '16px',
                    lineHeight: '1.7',
                    minHeight: '140px',
                    whiteSpace: 'pre-line',
                    color: '#e2e8f0',
                    padding: '24px',
                    borderRadius: '16px',
                    backgroundColor: bgDark,
                    border: '1px solid rgba(255, 255, 255, 0.02)',
                    boxShadow: shadowInner,
                    fontWeight: '500'
                }}>
                    {current.content}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                    {/* Pagination Dots */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        {pages.map((_, i) => (
                            <div key={i} style={{
                                width: '12px',
                                height: '12px',
                                borderRadius: '50%',
                                backgroundColor: bgDark,
                                boxShadow: i === page ? shadowInner : shadowOuter,
                                border: i === page ? '2px solid #4a90e2' : '1px solid rgba(255,255,255,0.02)'
                            }} />
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: '16px' }}>
                        <button
                            disabled={page === 0}
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            style={page === 0 ? btnDisabledStyle : btnStyle}
                            onMouseDown={e => { if (page !== 0) e.currentTarget.style.boxShadow = shadowActive; }}
                            onMouseUp={e => { if (page !== 0) e.currentTarget.style.boxShadow = shadowOuter; }}
                            onMouseLeave={e => { if (page !== 0) e.currentTarget.style.boxShadow = shadowOuter; }}
                        >
                            Back
                        </button>

                        {page < pages.length - 1 ? (
                            <button
                                onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))}
                                style={btnPrimaryStyle}
                                onMouseDown={e => e.currentTarget.style.boxShadow = shadowActive}
                                onMouseUp={e => e.currentTarget.style.boxShadow = shadowOuter}
                                onMouseLeave={e => e.currentTarget.style.boxShadow = shadowOuter}
                            >
                                Next
                            </button>
                        ) : (
                            <button
                                onClick={onClose}
                                style={{ ...btnStyle, color: '#38a169' }}
                                onMouseDown={e => e.currentTarget.style.boxShadow = shadowActive}
                                onMouseUp={e => e.currentTarget.style.boxShadow = shadowOuter}
                                onMouseLeave={e => e.currentTarget.style.boxShadow = shadowOuter}
                            >
                                Finish
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Instructions;
