export function ArtemisLogo({ size = 180 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 200 200"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="artemis-logo"
		>
			<defs>
				<linearGradient id="red-trajectory" x1="0%" y1="100%" x2="100%" y2="0%">
					<stop offset="0%" stopColor="#E53935" />
					<stop offset="50%" stopColor="#EF5350" />
					<stop offset="100%" stopColor="#E53935" />
				</linearGradient>
				<linearGradient id="blue-crescent" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="#1E88E5" />
					<stop offset="100%" stopColor="#1565C0" />
				</linearGradient>
				<linearGradient id="moon-grad" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="#B0BEC5" />
					<stop offset="100%" stopColor="#90A4AE" />
				</linearGradient>
				<filter id="logo-shadow" x="-20%" y="-20%" width="140%" height="140%">
					<feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#1565C0" floodOpacity="0.3" />
				</filter>
			</defs>

			{/* Blue Earth Crescent — bottom arc */}
			<path
				d="M30 155 Q60 185, 100 178 Q150 168, 175 135 Q160 155, 120 162 Q70 170, 30 155Z"
				fill="url(#blue-crescent)"
				filter="url(#logo-shadow)"
			/>

			{/* Red Trajectory Swoosh */}
			<path
				d="M22 140 Q20 90, 55 55 Q85 25, 130 35 Q155 42, 165 65 Q145 48, 115 45 Q75 42, 50 80 Q38 110, 45 140 Q32 142, 22 140Z"
				fill="url(#red-trajectory)"
				stroke="#E53935"
				strokeWidth="1"
			/>

			{/* Moon Circle — upper right */}
			<circle cx="148" cy="58" r="18" fill="url(#moon-grad)" opacity="0.9" />

			{/* Charcoal A Letterform */}
			<path
				d="M68 165 L100 40 L132 165 L112 165 L106 138 L94 138 L88 165 Z M97 122 L103 122 L100 105 Z"
				fill="#455A64"
				stroke="#37474F"
				strokeWidth="1.5"
				strokeLinejoin="round"
			/>
		</svg>
	)
}
