import { db } from '../../db/index.js';
import { projectPhotos, projects, partners, customers } from '../../db/schema.js';
import { eq, and, desc, sql, or, ilike } from 'drizzle-orm';
import { storageService } from '../../services/storage.service.js';
import type { ProjectPhotoDto } from './project.types.js';
import type { JwtTokenPayload } from '../../types/auth.types.js';

export class PhotoError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = 'PHOTO_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ProjectPhotoService {
  mapToDto(p: typeof projectPhotos.$inferSelect, extra?: { projectName?: string | null; customer?: string | null }): ProjectPhotoDto {
    return {
      id: p.id,
      projectId: p.projectId,
      uploadedByUserId: p.uploadedByUserId,
      photoUrl: p.photoUrl,
      title: p.title,
      phase: p.phase,
      craftsman: p.craftsman,
      caption: p.caption,
      tag: p.tag,
      visibleToCustomer: p.visibleToCustomer,
      projectName: extra?.projectName,
      customer: extra?.customer,
      createdAt: p.createdAt.toISOString(),
    };
  }

  /**
   * GET /api/photos
   * Global photo gallery across all projects for Admin Photos Manager
   */
  async getGlobalPhotos(
    query: { projectId?: string; search?: string; page?: number; limit?: number },
    user: JwtTokenPayload
  ): Promise<{ data: ProjectPhotoDto[]; total: number; page: number; limit: number }> {
    if (user.role !== 'admin') {
      throw new PhotoError('Only admins can view global photos gallery', 403, 'FORBIDDEN');
    }

    const page = query.page || 1;
    const limit = query.limit || 50;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];

    if (query.projectId && query.projectId !== 'All') {
      conditions.push(eq(projectPhotos.projectId, query.projectId));
    }

    if (query.search && query.search.trim()) {
      const s = `%${query.search.trim()}%`;
      conditions.push(
        or(
          ilike(projectPhotos.title, s),
          ilike(projectPhotos.caption, s),
          ilike(projectPhotos.phase, s),
          ilike(projectPhotos.craftsman, s),
          ilike(projects.name, s),
          ilike(customers.firstName, s),
          ilike(customers.lastName, s)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(projectPhotos)
      .leftJoin(projects, eq(projectPhotos.projectId, projects.id))
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .where(whereClause);

    const rows = await db
      .select({
        photo: projectPhotos,
        projectTitle: projects.name,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
      })
      .from(projectPhotos)
      .leftJoin(projects, eq(projectPhotos.projectId, projects.id))
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(projectPhotos.createdAt))
      .limit(limit)
      .offset(offset);

    const data = rows.map((r) =>
      this.mapToDto(r.photo, {
        projectName: r.projectTitle,
        customer: r.customerFirstName ? `${r.customerFirstName} ${r.customerLastName || ''}`.trim() : null,
      })
    );

    return {
      data,
      total: Number(countResult?.count || 0),
      page,
      limit,
    };
  }

  /**
   * GET /api/projects/:id/photos
   * Enforces customer scoping: customers only see visible_to_customer = true
   */
  async getPhotos(projectId: string, user: JwtTokenPayload): Promise<ProjectPhotoDto[]> {
    const [project] = await db
      .select({ id: projects.id, customerId: projects.customerId, partnerId: projects.partnerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new PhotoError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    if (user.role === 'customer') {
      const [c] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.userId, user.sub))
        .limit(1);

      if (!c || project.customerId !== c.id) {
        throw new PhotoError('You are not authorized to view photos for this project', 403, 'FORBIDDEN');
      }

      const rows = await db
        .select()
        .from(projectPhotos)
        .where(and(eq(projectPhotos.projectId, projectId), eq(projectPhotos.visibleToCustomer, true)))
        .orderBy(desc(projectPhotos.createdAt));

      return rows.map((r) => this.mapToDto(r));
    }

    if (user.role === 'partner') {
      const [p] = await db
        .select({ id: partners.id })
        .from(partners)
        .where(eq(partners.userId, user.sub))
        .limit(1);

      if (!p || project.partnerId !== p.id) {
        throw new PhotoError('You are not authorized to view photos for this project', 403, 'FORBIDDEN');
      }
    }

    const rows = await db
      .select()
      .from(projectPhotos)
      .where(eq(projectPhotos.projectId, projectId))
      .orderBy(desc(projectPhotos.createdAt));

    return rows.map((r) => this.mapToDto(r));
  }

  /**
   * POST /api/projects/:id/photos
   */
  async uploadPhoto(
    projectId: string,
    data: {
      photoUrl: string;
      title?: string | null;
      phase?: string | null;
      craftsman?: string | null;
      caption?: string | null;
      tag?: string | null;
      visibleToCustomer?: boolean;
    },
    user: JwtTokenPayload
  ): Promise<ProjectPhotoDto> {
    if (user.role === 'customer') {
      throw new PhotoError('Customers cannot upload photos', 403, 'FORBIDDEN');
    }

    const [project] = await db
      .select({ id: projects.id, partnerId: projects.partnerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new PhotoError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    if (user.role === 'partner') {
      const [p] = await db
        .select({ id: partners.id })
        .from(partners)
        .where(eq(partners.userId, user.sub))
        .limit(1);

      if (!p || project.partnerId !== p.id) {
        throw new PhotoError('Partners can only upload photos to their assigned projects', 403, 'FORBIDDEN');
      }
    }

    let finalPhotoUrl = data.photoUrl;

    // If base64 dataUri was provided, persist to storage with photo validation
    if (data.photoUrl.startsWith('data:image')) {
      const saved = await storageService.saveBase64(
        `projects/${projectId}/photos`,
        `photo_${Date.now()}.png`,
        data.photoUrl,
        'image/png',
        true
      );
      finalPhotoUrl = saved.filePath;
    }

    const [created] = await db
      .insert(projectPhotos)
      .values({
        projectId,
        uploadedByUserId: user.sub,
        photoUrl: finalPhotoUrl,
        title: data.title || null,
        phase: data.phase || null,
        craftsman: data.craftsman || (user.role === 'admin' ? 'Tim & Bram (Admin)' : 'Craftsman'),
        caption: data.caption || null,
        tag: data.tag || 'general',
        visibleToCustomer: data.visibleToCustomer ?? true,
      })
      .returning();

    return this.mapToDto(created);
  }

  /**
   * PATCH /api/photos/:photoId OR PATCH /api/projects/:id/photos/:photoId
   */
  async updatePhoto(
    arg1: string,
    arg2: any,
    arg3: any,
    arg4?: any
  ): Promise<ProjectPhotoDto> {
    let photoId: string;
    let data: any;
    let user: JwtTokenPayload;
    let projectId: string | undefined;

    if (arg4 !== undefined) {
      projectId = arg1;
      photoId = arg2;
      data = arg3;
      user = arg4;
    } else {
      photoId = arg1;
      data = arg2;
      user = arg3;
    }

    if (user.role !== 'admin') {
      throw new PhotoError('Only admins can edit photo details', 403, 'FORBIDDEN');
    }

    const conditions = [eq(projectPhotos.id, photoId)];
    if (projectId) {
      conditions.push(eq(projectPhotos.projectId, projectId));
    }

    const [photo] = await db
      .select()
      .from(projectPhotos)
      .where(and(...conditions))
      .limit(1);

    if (!photo) {
      throw new PhotoError('Photo not found', 404, 'NOT_FOUND');
    }

    const updateValues: Record<string, any> = {};
    if (data.title !== undefined) updateValues.title = data.title;
    if (data.phase !== undefined) updateValues.phase = data.phase;
    if (data.craftsman !== undefined) updateValues.craftsman = data.craftsman;
    if (data.caption !== undefined) updateValues.caption = data.caption;
    if (data.tag !== undefined) updateValues.tag = data.tag;
    if (data.visibleToCustomer !== undefined) updateValues.visibleToCustomer = data.visibleToCustomer;

    // If replacement photo file provided (base64)
    if (data.photoUrl && data.photoUrl.startsWith('data:image')) {
      const saved = await storageService.saveBase64(
        `projects/${photo.projectId}/photos`,
        `photo_replaced_${Date.now()}.png`,
        data.photoUrl,
        'image/png',
        true
      );
      updateValues.photoUrl = saved.filePath;

      // Purge old local file
      if (photo.photoUrl && !photo.photoUrl.startsWith('http')) {
        await storageService.deleteFile(photo.photoUrl);
      }
    }

    const [updated] = await db
      .update(projectPhotos)
      .set(updateValues)
      .where(eq(projectPhotos.id, photoId))
      .returning();

    return this.mapToDto(updated);
  }

  /**
   * PATCH /api/photos/:photoId/visibility
   * Quick toggle customer visibility
   */
  async toggleVisibility(
    photoId: string,
    user: JwtTokenPayload,
    explicitVisible?: boolean
  ): Promise<ProjectPhotoDto> {
    if (user.role !== 'admin') {
      throw new PhotoError('Only admins can toggle photo customer visibility', 403, 'FORBIDDEN');
    }

    const [photo] = await db
      .select()
      .from(projectPhotos)
      .where(eq(projectPhotos.id, photoId))
      .limit(1);

    if (!photo) {
      throw new PhotoError('Photo not found', 404, 'NOT_FOUND');
    }

    const newVisibility = explicitVisible !== undefined ? explicitVisible : !photo.visibleToCustomer;

    const [updated] = await db
      .update(projectPhotos)
      .set({ visibleToCustomer: newVisibility })
      .where(eq(projectPhotos.id, photoId))
      .returning();

    return this.mapToDto(updated);
  }

  /**
   * DELETE /api/photos/:photoId OR DELETE /api/projects/:id/photos/:photoId
   * Deletes database record AND removes physical storage object
   */
  async deletePhoto(
    arg1: string,
    arg2?: any,
    arg3?: any
  ): Promise<{ success: boolean; deletedId: string }> {
    let photoId: string;
    let user: JwtTokenPayload;
    let projectId: string | undefined;

    if (arg3 !== undefined) {
      projectId = arg1;
      photoId = arg2;
      user = arg3;
    } else {
      photoId = arg1;
      user = arg2;
    }

    if (user.role !== 'admin') {
      throw new PhotoError('Only admins can delete project photos', 403, 'FORBIDDEN');
    }

    const conditions = [eq(projectPhotos.id, photoId)];
    if (projectId) {
      conditions.push(eq(projectPhotos.projectId, projectId));
    }

    const [photo] = await db
      .select()
      .from(projectPhotos)
      .where(and(...conditions))
      .limit(1);

    if (!photo) {
      throw new PhotoError('Photo not found', 404, 'NOT_FOUND');
    }

    // Delete DB record
    await db.delete(projectPhotos).where(eq(projectPhotos.id, photoId));

    // Cleanup physical file if stored locally
    if (photo.photoUrl && !photo.photoUrl.startsWith('http')) {
      await storageService.deleteFile(photo.photoUrl);
    }

    return { success: true, deletedId: photoId };
  }

  /**
   * GET /api/customer/projects/:id/photos
   * Scoped photos for customer portal view
   */
  async getCustomerPhotosForProject(
    projectId: string,
    user: JwtTokenPayload
  ): Promise<{ project: any; photos: any[] }> {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new PhotoError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    if (user.role === 'customer') {
      const [c] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.userId, user.sub))
        .limit(1);

      if (!c || project.customerId !== c.id) {
        throw new PhotoError('You are not authorized to view photos for this project', 403, 'FORBIDDEN');
      }
    }

    const rows = await db
      .select()
      .from(projectPhotos)
      .where(and(eq(projectPhotos.projectId, projectId), eq(projectPhotos.visibleToCustomer, true)))
      .orderBy(desc(projectPhotos.createdAt));

    const mappedPhotos = rows.map((p) => ({
      id: p.id,
      title: p.title || p.caption || 'Workshop Update',
      phase: p.phase || 'Werkplaats Update',
      description: p.caption,
      craftsman: p.craftsman,
      photoUrl: p.photoUrl,
      img: p.photoUrl,
      tag: p.tag,
      date: p.createdAt.toISOString().split('T')[0],
      createdAt: p.createdAt.toISOString(),
    }));

    return {
      project: {
        id: project.id,
        projectNumber: project.projectNumber,
        title: project.name,
        name: project.name,
        status: project.status,
      },
      photos: mappedPhotos,
    };
  }
}

export const projectPhotoService = new ProjectPhotoService();
