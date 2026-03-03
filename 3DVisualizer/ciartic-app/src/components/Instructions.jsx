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
            content: "Use your mouse to look around.\n- Left Click + Drag: Rotate camera\n- Right Click + Drag: Pan camera\n- Scroll Wheel: Zoom in/out"
        },
        {
            title: "C-Arm Controls",
            content: "Use the control panel on the right to adjust the C-arm positioning.\n- Lift: Adjust height\n- Column Rot: Rotate the main column\n- WigWag & Orbital: Angle the detector\n- Cart X/Z: Move the machine along the floor."
        },
        {
            title: "Taking X-Rays",
            content: "Once the patient is in the beam path, click the green 'TAKE X-RAY' button on the control panel to capture an image. The live fluoroscopy view will update with the simulated X-ray."
        },
        {
            title: "Keyboard Shortcuts",
            content: "- Press 'P' to toggle Patient visibility.\n- Press 'L' to toggle skeleton landmarks.\n- Press 'D' to toggle the Debug view & floor labels.\n- Press 'C' to connect/disconnect the Arduino."
        }
    ];

    const current = pages[page];

    return (
        <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backdropFilter: 'blur(5px)'
        }}>
            <div style={{
                backgroundColor: 'rgba(30, 40, 50, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '16px',
                padding: '30px',
                width: '500px',
                maxWidth: '90vw',
                color: 'white',
                fontFamily: 'sans-serif',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '15px' }}>
                    <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', color: '#4a90e2' }}>
                        {current.title}
                    </h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#aaa',
                            cursor: 'pointer',
                            fontSize: '20px',
                            padding: '5px'
                        }}
                    >
                        ✕
                    </button>
                </div>

                <div style={{ fontSize: '16px', lineHeight: '1.6', minHeight: '120px', whiteSpace: 'pre-line', color: '#ddd' }}>
                    {current.content}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                    <div style={{ display: 'flex', gap: '5px' }}>
                        {pages.map((_, i) => (
                            <div key={i} style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: i === page ? '#4a90e2' : 'rgba(255,255,255,0.2)'
                            }} />
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                            disabled={page === 0}
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '8px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: 'transparent',
                                color: page === 0 ? 'rgba(255,255,255,0.3)' : 'white',
                                cursor: page === 0 ? 'not-allowed' : 'pointer'
                            }}
                        >
                            Back
                        </button>

                        {page < pages.length - 1 ? (
                            <button
                                onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))}
                                style={{
                                    padding: '8px 24px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: '#4a90e2',
                                    color: 'white',
                                    fontWeight: 'bold',
                                    cursor: 'pointer'
                                }}
                            >
                                Next
                            </button>
                        ) : (
                            <button
                                onClick={onClose}
                                style={{
                                    padding: '8px 24px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: '#2ecc71',
                                    color: 'white',
                                    fontWeight: 'bold',
                                    cursor: 'pointer'
                                }}
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
