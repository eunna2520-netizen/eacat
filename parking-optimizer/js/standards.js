// 주차장 설계 참고 기준값 (국내 주차장법 시행규칙 별표1 등을 참고한 일반적 수치)
// 실제 프로젝트에서는 해당 지자체 조례, 소방/장애인 관련 법규를 반드시 별도 확인해야 합니다.
const Standards = {
  disclaimer:
    "본 수치는 주차장법 시행규칙 등을 참고한 일반적인 기준이며, 지자체 조례 및 개별 현장 여건에 따라 달라질 수 있습니다. 실제 인허가 설계에는 반드시 관련 법규를 재확인하세요.",

  stallTypes: {
    general: { label: "일반형", width: 2.5, length: 5.0 },
    compact: { label: "경형", width: 2.0, length: 3.6 },
    extended: { label: "확장형", width: 2.6, length: 5.2 },
    disabled: { label: "장애인전용", width: 3.3, length: 5.0 },
    parallelGeneral: { label: "평행주차 일반형", width: 2.0, length: 6.0 },
  },

  // 주차형식별 최소 차로 너비(m) - 양방향(2-way) 통행 기준 참고치
  aisleWidthByAngle: {
    0: 3.3,   // 평행주차
    30: 3.3,
    45: 3.5,
    60: 4.5,
    90: 6.0,
  },

  // 일방통행(1-way) 최소 차로 너비 참고치 (좁은 대지에서 사용, 소방/법규 확인 필수)
  aisleWidthOneWayByAngle: {
    0: 3.0,
    30: 3.0,
    45: 3.0,
    60: 3.5,
    90: 3.5,
  },

  parkingAngleOptions: [90, 60, 45, 30, 0],
};
