export interface ILocalizedTypeName {
    zh: string;
}

export interface ILocalizedPetsName {
    zh: {
        name: string;
    };
}

export interface ILocalizedPetsText {
    zh: {
        name: string;
        description: string;
    };
}

export interface IPetsType {
    id: number;
    name: string;
    localized: ILocalizedTypeName;
}

export interface IPetsSpecies {
    id: number;
    name: string;
    localized: ILocalizedTypeName;
}

export interface IPetsTrait {
    id: number;
    name: string;
    description: string;
    icon_id: string | null;
    localized: ILocalizedPetsText;
}

export interface IPetsMove {
    id: number;
    name: string;
    icon_id: string | null;
    move_type: IPetsType;
    localized: ILocalizedPetsText;
    move_category: string;
    energy_cost: number;
    power: number | null;
    description: string;
}

export interface IPersonality {
    id: number;
    name: string;
    hp_mod_pct: number;
    phy_atk_mod_pct: number;
    mag_atk_mod_pct: number;
    phy_def_mod_pct: number;
    mag_def_mod_pct: number;
    spd_mod_pct: number;
    localized: {
        zh: string;
    };
}

export interface IPetBloodlineMoveSummary {
    move_id: number;
    move_name: string;
    type_label: string;
}

export interface IPetBloodlineIndexEntry {
    pet_id: number;
    pet_name: string;
    implemented: boolean;
    bloodline_moves: IPetBloodlineMoveSummary[];
}

export interface IPetSkillIndexEntry {
    pet_id: number;
    move_pool_ids: number[];
    move_stone_ids: number[];
}

export interface IPetSkillCatalogEntry {
    id: number;
    name: string;
    type_label: string;
    move_category: string;
}

export interface IPetSkillIndexPayload {
    entries: IPetSkillIndexEntry[];
    skills: IPetSkillCatalogEntry[];
}

export interface IPetsBreedingVariant {
    id: number | null;
    pet_id: number | null;
    name: string | null;
    model_id: number | null;
    hatch_data: number | null;
    weight_low: number | null;
    weight_high: number | null;
    height_low: number | null;
    height_high: number | null;
    precious_egg_type?: number | null;
    egg_base_glass_prob_array?: number[] | null;
    egg_add_glass_prob_array?: number[] | null;
    is_contact_add_glass_prob?: boolean | null;
    is_contact_add_shining_prob?: boolean | null;
}

export interface IPetsBreedingInfo extends IPetsBreedingVariant {
    variants: IPetsBreedingVariant[];
}

export interface IPetsBreedingProfile {
    pet_base_id: number | null;
    egg_groups: number[];
    proportion_male: number | null;
    male_rate: number | null;
    female_rate: number | null;
}

export interface IPetsCatchInfo {
    catch_threshold: number | null;
    catch_guarant_rate: number | null;
    catch_ball_level: number | null;
}

export interface IPetsWorldProfile {
    type_desc: string | null;
    description_habitat: string | null;
    introduction: string | null;
    refresh_locations: string[];
    handbook_areas?: string[];
    movement_type: string | null;
    classis_id: number | null;
    classis_name: string | null;
    handbook_area_ids: number[];
}

export interface IPetsLegacyMove {
    monster_id: number;
    type_id: number;
    move_id: number;
    move?: IPetsMove | null;
}

export interface IPetsEvolutionNode {
    id: number;
    species_id: number;
    name: string;
    form: string;
    localized: ILocalizedPetsName;
    is_leader_form: boolean;
    main_type: IPetsType;
    sub_type: IPetsType | null;
    evolution_conditions: string[];
}

export interface IPetsEvolutionStage {
    depth: number;
    is_leader_stage?: boolean;
    monsters: IPetsEvolutionNode[];
}

export interface IPetsEvolutionTree {
    stages: IPetsEvolutionStage[];
    max_depth: number;
    total_unique_monsters: number;
    species_id: number;
    current_monster_id: number;
}

export interface IPets {
    id: number;
    species_id: number;
    name: string;
    form: string;
    main_type: IPetsType;
    sub_type: IPetsType | null;
    default_legacy_type: IPetsType;
    leader_potential: boolean;
    is_leader_form: boolean;
    preferred_attack_style: string;
    localized: ILocalizedPetsName;
    implemented: boolean;
    base_hp: number;
    base_phy_atk: number;
    base_mag_atk: number;
    base_phy_def: number;
    base_mag_def: number;
    base_spd: number;
    evolves_from_id: number | null;
    world_profile?: IPetsWorldProfile | null;
    breeding?: IPetsBreedingInfo | null;
    breeding_profile?: IPetsBreedingProfile | null;
}

export interface IPetsDetail extends IPets {
    species: IPetsSpecies;
    trait: IPetsTrait | null;
    catch_info: IPetsCatchInfo | null;
    move_pool: IPetsMove[];
    move_stones: IPetsMove[];
    legacy_moves: IPetsLegacyMove[];
    evolution_tree: IPetsEvolutionTree;
}

export interface IMonsterTypeDetail {
    id: number;
    name: string;
    localized: ILocalizedTypeName;
    vulnerable_to: string[];
    resistant_to: string[];
}

export interface IItemRelatedPet {
    id: number;
    name: string;
}

export interface IItemRecipeMaterial {
    id: number;
    name: string;
    icon_id: string | null;
}

export interface IItemRecipeCostGroup {
    options: IItemRecipeMaterial[];
    count: number;
}

export interface IItemRecipe {
    cost: IItemRecipeCostGroup[];
    can_craft: boolean;
}

export interface IItem {
    id: number;
    name: string;
    icon_id: string | null;
    description: string;
    flavor_text: string | null;
    category: string | null;
    type_desc: string | null;
    quality: number;
    quality_label: string;
    acquire_ways: string[];
    related_pets: IItemRelatedPet[];
    recipes?: IItemRecipe[];
}

export interface IOfficialPokedexEntry {
    no: string | null;
    form: string | null;
    height: string | null;
    weight: string | null;
    habitat: string | null;
    nickname: string | null;
    description: string | null;
}

export interface IOfficialPokedexPayload {
    schema_version: number;
    generated_at: string;
    source: {
        site: string;
        page: string;
    };
    entries: Record<string, IOfficialPokedexEntry>;
}

export interface IOfficialSkillLearnRecord {
    id: number;
    name: string;
    pool: string;
    level: string | null;
}

export interface IOfficialSkillEntry {
    name: string;
    move_id: number | null;
    category: string | null;
    element: string | null;
    energy_cost: number | null;
    power: number | null;
    effect: string | null;
    learn_pets: IOfficialSkillLearnRecord[];
}

export interface IOfficialSkillsPayload {
    schema_version: number;
    generated_at: string;
    source: {
        site: string;
        page: string;
    };
    pool_labels: string[];
    entries: Record<string, IOfficialSkillEntry>;
}

export interface IMerchantItem {
    name: string;
    category: string;
    description: string;
    image: string | null;
    price: number | null;
    limit: number | null;
    rare: boolean;
}

export interface IMerchantRound {
    index: number;
    start_ts: number;
    end_ts: number;
    start_time: string;
    end_time: string;
    items: IMerchantItem[];
}

export interface IMerchantPayload {
    schema_version: number;
    generated_at: string;
    source: {
        site: string;
        page: string;
        image_source: string;
    };
    date: string | null;
    rounds: IMerchantRound[];
}

export interface IMerchantHistoryRound {
    index: number;
    start_time: string;
    end_time: string;
    recorded_at: string;
    items: IMerchantItem[];
}

export interface IMerchantHistoryDay {
    date: string;
    rounds: Record<string, IMerchantHistoryRound>;
}

export interface IMerchantHistoryPayload {
    schema_version: number;
    updated_at: string | null;
    days: Record<string, IMerchantHistoryDay>;
}

export interface IFashionPiece {
    id: number;
    name: string;
    slot: string;
    quality: number;
}

export interface IFashionVariant {
    gender: string;
    gender_label: string;
    name: string;
    description: string;
    grade_name: string;
    acquire: string[];
    item_count: number;
    image: string | null;
    image_url: string | null;
    pieces: IFashionPiece[];
}

export interface IFashionBondPet {
    name: string | null;
    form: string | null;
}

export interface IFashionBond {
    id: number | null;
    name: string | null;
    quality_name: string | null;
    style: string | null;
    series_id: number | null;
    text: string | null;
    interaction_text: string | null;
    normal_text: string | null;
    icon: string | null;
    image_url: string | null;
    pets: IFashionBondPet[];
}

export interface IFashionSeries {
    id: number;
    name: string | null;
    description: string | null;
    tags: string | null;
    art: string | null;
    art_url: string | null;
    icon: string | null;
    icon_url: string | null;
}

export interface IFashionEntry {
    wiki_key: string;
    name: string;
    description: string | null;
    quality: number;
    grade: number;
    grade_name: string;
    series_id: number | null;
    genders: string[];
    bonds: IFashionBond[];
    variants: IFashionVariant[];
}

export interface IFashionPayload {
    schema_version: number;
    generated_at: string;
    source: {
        site: string;
        page: string;
    };
    series: IFashionSeries[];
    entries: Record<string, IFashionEntry>;
}

export interface IMedalTask {
    condition_label: string;
    count: number;
    deprecated: boolean;
    description: string;
    id: number;
}

export interface IMedalEntry {
    wiki_key: string;
    name: string;
    description: string;
    prefix_text: string;
    quality: number;
    quality_label: string;
    type_label: string;
    image: string | null;
    image_url: string | null;
    tasks: IMedalTask[];
}

export interface IMedalPayload {
    schema_version: number;
    generated_at: string;
    source: {
        site: string;
        page: string;
    };
    entries: Record<string, IMedalEntry>;
}
