export const CHART_SAMPLES: Record<string, string> = {
  flowchart: `---
config:
  look: handDrawn
---
flowchart TD
    Start([Start])
    Start --> Describe[Describe Diagram]
    Start --> Upload[Upload Image]

    Describe --> AI[[AI Agent]]
    Upload --> AI

    AI --> Code[Mermaid Code]
    Code --> Preview[Live Preview]

    %% Feedback Loops
    Code -- "iterate/feedback" --> AI`,

  sequence: `---
config:
  theme: forest
---
sequenceDiagram
    autonumber
    actor User
    participant App as AI Application
    participant Embed as Embedding Model
    participant DB as Vector Database
    participant LLM as Large Language Model

    User->>App: "Use internal XYZ ..."
    App->>Embed: Sent query
    activate Embed
    Embed-->>App: Return vector
    deactivate Embed
    
    App->>DB: Search for similar vectors
    activate DB
    DB-->>App: Return top relevant documents
    deactivate DB
    
    App->>LLM: Send Prompt + Context + Query
    activate LLM
    LLM-->>App: Synthesize grounded response
    deactivate LLM
    
    App-->>User: "With XYZ, ..."`,

  class: `classDiagram
    class Animal {
        +String name
        +int age
        +speak() String
    }
    class Dog {
        +String breed
        +fetch() void
    }
    class Cat {
        +bool indoor
        +purr() void
    }
    Animal <|-- Dog
    Animal <|-- Cat`,

  state: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : start
    Processing --> Success : done
    Processing --> Failure : error
    Success --> Idle : reset
    Failure --> Idle : retry
    Success --> [*]`,

  er: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "referenced by"

    CUSTOMER {
        int    id PK
        string name
        string email
    }
    ORDER {
        int  id PK
        date placed_at
    }
    PRODUCT {
        int    id PK
        string title
        float  price
    }
    LINE_ITEM {
        int id PK
        int quantity
    }`,

  gantt: `gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Planning
        Research      :a1, 2024-01-01, 7d
        Design        :a2, after a1, 5d
    section Development
        Backend       :b1, after a2, 10d
        Frontend      :b2, after a2, 10d
    section Launch
        Testing       :c1, after b1, 5d
        Deploy        :c2, after c1, 2d`,

  pie: `pie title Browser Market Share
    "Chrome"  : 65.5
    "Safari"  : 18.9
    "Firefox" : 4.0
    "Edge"    : 4.2
    "Other"   : 7.4`,

  mindmap: `---
config:
  theme: dark
  layout: tidy-tree
---
mindmap
  root((Artificial<br/>Intelligence))
    Machine Learning
      Supervised Learning
      Unsupervised Learning
      Reinforcement Learning
    Deep Learning
      Neural Networks
      Transformers
      CNNs & RNNs
    Natural Language Processing
      Text Generation
      Sentiment Analysis
      Translation
    Computer Vision
      Image Recognition
      Object Detection`,

  timeline: `timeline
    title History of the Web
    1991 : World Wide Web launched
    1995 : JavaScript introduced
    2004 : Web 2.0 era begins
    2008 : Chrome browser released
    2015 : ES6 modernises JS
    2023 : AI-assisted development`,

  quadrant: `quadrantChart
    title Feature Priority Matrix
    x-axis Low Effort --> High Effort
    y-axis Low Impact --> High Impact
    quadrant-1 Quick Wins
    quadrant-2 Major Projects
    quadrant-3 Fill-ins
    quadrant-4 Thankless Tasks
    Dark Mode: [0.3, 0.8]
    API v2: [0.8, 0.9]
    Bug Fixes: [0.2, 0.6]
    Onboarding: [0.6, 0.7]
    Legacy Cleanup: [0.7, 0.3]`,

  xychart: `xychart-beta
    title "Monthly Revenue (USD)"
    x-axis [Jan, Feb, Mar, Apr, May, Jun]
    y-axis "Revenue" 0 --> 100000
    bar [42000, 55000, 61000, 48000, 73000, 89000]
    line [42000, 55000, 61000, 48000, 73000, 89000]`,

  sankey: `---
config:
  sankey:
    nodeAlignment: center
---
sankey

%% Tier 1: Top Level Budget
RAG Budget,Hosting,45
RAG Budget,LLM API,40
RAG Budget,Vector DB,15

%% Tier 2: Hosting and API Breakdown
Hosting,Compute,35
Hosting,Storage,10

LLM API,Inference,30
LLM API,Embedding,10

%% Tier 3: Workload Specifics
Compute,Production Environment,25
Compute,Dev/Test Environment,10

Inference,Chat Queries,25
Inference,System Prompts,5

Embedding,Initial Doc Ingestion,8
Embedding,Daily Syncs,2`,

  block: `---
config:
  theme: base
  themeVariables:
    primaryColor: "#f4f4f4"
    primaryBorderColor: "#333"
---
block-beta
  columns 3

  User("User Interface<br/>Chat App"):3
  
  Memory[("Vector<br/>Memory")]
  Core{"Agent<br/>Core"}
  Tools[["External<br/>APIs"]]
  
  LLM("Foundation Model<br/>(LLM)"):3
  
  User <--> Core
  Core <--> Memory
  Core <--> Tools
  Core <--> LLM
  
  classDef core fill:#e1bee7,stroke:#8e24aa,stroke-width:2px
  class Core core`,

  architecture: `architecture-beta
    group cloud_env(cloud)[AI Application Cloud]

    service client(internet)[Client App]
    
    service api(server)[API Gateway] in cloud_env
    service engine(server)[RAG Engine] in cloud_env
    service db(database)[Vector DB] in cloud_env
    service model(server)[LLM Service] in cloud_env

    %% 1. The user sends a request to the API
    client:R --> L:api

    %% 2. The API routes the request to the core Engine
    api:R --> L:engine

    %% 3. The Engine fetches context from the Vector DB
    engine:T <--> B:db

    %% 4. The Engine sends the prompt + context to the LLM
    engine:R <--> L:model`,

  kanban: `kanban
    todo[To Do]
      task1[Design database schema]
      task2[Write API spec]
    inprogress[In Progress]
      task3[Implement auth]
      task4[Build UI components]
    review[In Review]
      task5[Code review PR #42]
    done[Done]
      task6[Set up CI/CD]
      task7[Deploy staging env]`,
  radar: `---
title: "Team Skills"
---
radar-beta
    axis fe["Frontend"], be["Backend"], db["Database"]
    axis devops["DevOps"], security["Security"], ux["UX"]
    curve alice["Alice"]{90, 70, 60, 50, 65, 80}
    curve bob["Bob"]{55, 90, 85, 75, 70, 40}
    curve carol["Carol"]{70, 60, 55, 90, 85, 65}

    max 100
    min 0`,

  requirement: `requirementDiagram

    %% --- Requirements ---
    requirement EnterpriseChat {
      id: "REQ-01"
      text: "System must provide an enterprise-grade AI chat assistant."
      risk: high
      verifyMethod: demonstration
    }

    requirement DataPrivacy {
      id: "REQ-01.A"
      text: "Internal data must not be used to train public models."
      risk: high
      verifyMethod: inspection
    }

    requirement LowLatency {
      id: "REQ-01.B"
      text: "AI responses must stream within 1.5 seconds."
      risk: medium
      verifyMethod: test
    }

    %% --- Elements (The actual system parts) ---
    element LocalLLM {
      type: "AI Engine"
      docRef: "Model_Specs_v2"
    }

    element AuthGateway {
      type: "Security Layer"
      docRef: "Sec_Policy_99"
    }

    element SemanticCache {
      type: "Database"
      docRef: "Arch_Diagram"
    }

    %% --- Relationships ---
    
    %% Breaking down the main requirement into sub-requirements
    EnterpriseChat <- contains - DataPrivacy
    EnterpriseChat <- contains - LowLatency

    %% Mapping the elements to the requirements they fulfill
    LocalLLM - satisfies -> EnterpriseChat
    AuthGateway - satisfies -> DataPrivacy
    SemanticCache - satisfies -> LowLatency`,

  treemap: `treemap-beta
"Frontend"
    "React": 45
    "CSS": 20
    "Tests": 15
"Backend"
    "API"
        "REST": 30
        "GraphQL": 20
    "Database": 25
"DevOps"
    "CI/CD": 18
    "Monitoring": 12`,

  userjourney: `journey
    title User Checkout Flow
    section Browse
      Visit homepage: 5: User
      Search for product: 4: User
      View product page: 4: User
    section Purchase
      Add to cart: 5: User
      Enter shipping info: 3: User
      Enter payment: 2: User
      Confirm order: 4: User
    section Post-purchase
      Receive confirmation email: 5: User, System
      Track shipment: 4: User`,

};
