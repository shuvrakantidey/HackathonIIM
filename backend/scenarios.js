const scenarios = [
  {
    name: "Baseline / Safe",
    data: { fatigue: 10, drivingHours: 0.5, distraction: 2, rain: "none", isNight: false, tyrePressure: 34, engineTemp: 78 }
  },
  {
    name: "Fatigue only",
    data: { fatigue: 68, drivingHours: 3.5, distraction: 5, rain: "none", isNight: false, tyrePressure: 33, engineTemp: 80 }
  },
  {
    name: "Heavy rain only",
    data: { fatigue: 20, drivingHours: 1.2, distraction: 3, rain: "heavy", isNight: false, tyrePressure: 32, engineTemp: 79 }
  },
  {
    name: "Night + distraction",
    data: { fatigue: 30, drivingHours: 2, distraction: 45, rain: "none", isNight: true, tyrePressure: 31, engineTemp: 81 }
  },
  {
    name: "Vehicle issue only",
    data: { fatigue: 15, drivingHours: 1, distraction: 4, rain: "none", isNight: false, tyrePressure: 24, engineTemp: 105 }
  },
  {
    name: "Hero demo scenario",
    data: { fatigue: 72, drivingHours: 4.2, distraction: 8, rain: "heavy", isNight: true, tyrePressure: 29, engineTemp: 92 }
  },
  {
    name: "Worst case / critical",
    data: { fatigue: 90, drivingHours: 6, distraction: 60, rain: "heavy", isNight: true, tyrePressure: 22, engineTemp: 110 }
  },
  {
    name: "Recovering / improving",
    data: { fatigue: 25, drivingHours: 4.5, distraction: 5, rain: "light", isNight: true, tyrePressure: 31, engineTemp: 84 }
  }
];

module.exports = scenarios; 