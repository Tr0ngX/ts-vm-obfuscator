import React, { useState, useMemo } from 'react';
import { calculateSecretHash } from '@ts-vm-obfuscator/core-logic'; // Giả lập hàm đã bị obf

export default function SecureDashboard() {
  const [data, setData] = useState('');
  
  // Rules of Hooks: Không được virtualize khu vực render chứa hook
  // Chỉ virtualize phần logic tính toán bên trong
  const secureValue = useMemo(() => {
    // Vùng này an toàn để virtualize nếu không gọi thêm hook
    return calculateSecretHash(data, 0x12345);
  }, [data]);

  return (
    <div>
      <input value={data} onChange={e => setData(e.target.value)} />
      <div>Secure Hash: {secureValue}</div>
    </div>
  );
}
