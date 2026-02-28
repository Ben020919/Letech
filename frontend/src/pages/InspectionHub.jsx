import React from 'react';
import { useNavigate } from 'react-router-dom';


export default function InspectionHub() {
    const navigate = useNavigate();
    
    // 定義四個區域
    const zones = [
        { id: 'anymall', name: 'Anymall', color: '#4CAF50' },
        { id: 'hellobear', name: 'Hello Bear', color: '#2196F3' },
        { id: 'yummy', name: 'Yummy', color: '#FF9800' },
        { id: 'homey', name: 'Homey', color: '#E91E63' }
    ];

    return (
        <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}>
            <h1>🔍 3PL 貨品檢測中心</h1>
            <p style={{ fontSize: '18px', color: '#666', marginBottom: '40px' }}>請選擇您負責檢測的區域</p>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', justifyContent: 'center', maxWidth: '800px', margin: '0 auto' }}>
                {zones.map(zone => (
                    <button
                        key={zone.id}
                        onClick={() => navigate(`/inspection/${zone.id}`)}
                        style={{
                            padding: '30px 40px', 
                            fontSize: '24px', 
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            backgroundColor: zone.color, 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '12px',
                            minWidth: '200px',
                            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                            transition: 'transform 0.1s'
                        }}
                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        {zone.name}
                    </button>
                ))}
            </div>
        </div>
    );
}