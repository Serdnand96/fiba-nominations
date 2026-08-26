import React from 'react';

// FIBA — logo oficial.
// Los assets viven en /public y se sirven estáticos:
//   /fiba-mark.png  → recuadro cuadrado con la pelota (usos chicos / cuadrados)
//   /fiba-logo.png  → lockup horizontal completo (pelota + "FIBA / We Are Basketball")
// El logo trae fondo negro propio: NO recortarlo ni ponerlo sobre un fondo
// que le compita. Sobre claro y sobre oscuro se ve igual.

// === MARCA CUADRADA — uso primario en la app ===
function LogoMonogram({ size = 48, rounded = true, className = '' }) {
  return (
    <img
      src="/fiba-mark.png"
      alt="FIBA"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`flex-shrink-0 object-contain ${rounded ? 'rounded-lg' : ''} ${className}`}
    />
  );
}

// === LOCKUP HORIZONTAL — headers anchos, portadas, documentos ===
function LogoWordmark({ height = 32, className = '' }) {
  return (
    <img
      src="/fiba-logo.png"
      alt="FIBA — We Are Basketball"
      style={{ height, width: 'auto' }}
      className={`flex-shrink-0 object-contain ${className}`}
    />
  );
}

// === Lockup del sidebar — acento vertical + wordmark tipográfico ===
function LogoSidebar() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMonogram size={32} />
      <div className="leading-tight">
        <div className="text-[14px] font-semibold text-white tracking-tight">FIBA Americas</div>
        <div className="text-[10px] text-navy-300 font-semibold tracking-[0.12em] uppercase mt-0.5">Nominations</div>
      </div>
    </div>
  );
}

// Alias legacy: antes había marcas dibujadas a mano (roundel, shield, monograma
// con la "F"). Todas apuntan ahora al logo oficial.
const LogoMark = LogoMonogram;
const LogoRoundel = LogoMonogram;
const LogoShield = LogoMonogram;
const LogoWordmarkCompact = LogoWordmark;

export {
  LogoMonogram,
  LogoMark,
  LogoRoundel,
  LogoShield,
  LogoWordmark,
  LogoWordmarkCompact,
  LogoSidebar,
};
