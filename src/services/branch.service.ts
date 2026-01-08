import { PrismaClient, BranchOffice } from "../generated/prisma/client";
import prisma from "../config/prisma";

export class BranchService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = prisma;
  }

  /**
   * Crea una nueva sucursal
   */
  async createBranch(data: {
    name: string;
    isActive?: boolean | number;
    isPublic?: boolean;
    location?: string;
    address?: string;
    phone?: string;
    area?: string;
  }): Promise<BranchOffice> {
    return this.prisma.branchOffice.create({
      data: {
        ...data,
        // isActive: 0 = inactivo, 1 = activo (para sucursales)
        isActive:
          typeof data.isActive === "number"
            ? data.isActive === 1
            : data.isActive ?? true,
        isPublic: data.isPublic ?? true, // Default true
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Obtiene todas las sucursales
   * Opcionalmente filtra por una lista de IDs (útil para permisos de usuarios)
   */
  async getAllBranches(filterIds?: number[]): Promise<BranchOffice[]> {
    if (filterIds && filterIds.length > 0) {
      return this.prisma.branchOffice.findMany({
        where: {
          id: {
            in: filterIds,
          },
          isActive: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }

    return this.prisma.branchOffice.findMany({
      orderBy: {
        createdAt: "desc",
      },
      where: { isActive: true },
    });
  }

  /**
   * Obtiene una sucursal por ID
   */
  async getBranchById(id: number): Promise<BranchOffice | null> {
    return this.prisma.branchOffice.findFirst({
      where: { id, isActive: true },
    });
  }

  /**
   * Actualiza una sucursal
   */
  async updateBranch(
    id: number,
    data: Partial<BranchOffice>
  ): Promise<BranchOffice> {
    return this.prisma.branchOffice.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Elimina (o desactiva) una sucursal
   */
  async deleteBranch(id: number): Promise<BranchOffice> {
    return this.prisma.branchOffice.update({
      where: { id },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });
  }
}

export const branchService = new BranchService();
