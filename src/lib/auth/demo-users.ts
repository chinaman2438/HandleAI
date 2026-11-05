export const DEMO_USERS = {
  admin: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@meridian.demo",
    fullName: "Alex Moraes (Head of Receivables)",
    role: "admin" as const,
    organizationNormalized: null,
  },
  employee: {
    id: "00000000-0000-4000-8000-000000000002",
    email: "employee@meridian.demo",
    fullName: "Bruno Tavares (Receivables Specialist)",
    role: "employee" as const,
    organizationNormalized: null,
  },
  atlantica: {
    id: "00000000-0000-4000-8000-000000000011",
    email: "finance@atlantica.demo",
    fullName: "Mariana Costa (Grupo Atlântica Treasury)",
    role: "customer" as const,
    organizationNormalized: "grupo atlantica",
  },
  serraVerde: {
    id: "00000000-0000-4000-8000-000000000012",
    email: "finance@serraverde.demo",
    fullName: "Roberto Almeida (Grupo Serra Verde Finance)",
    role: "customer" as const,
    organizationNormalized: "grupo serra verde",
  },
  pilar: {
    id: "00000000-0000-4000-8000-000000000013",
    email: "finance@pilar.demo",
    fullName: "Carla Mendes (Construtora Pilar AP)",
    role: "customer" as const,
    organizationNormalized: "construtora pilar",
  },
};
